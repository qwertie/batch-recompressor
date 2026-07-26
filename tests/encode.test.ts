import { describe, it, expect } from 'vitest';
import {
  targetBps, targetDensity, ffmpegArgs, effortToPreset, outputExt, supportsQualityMode,
  estimatedSize, outputDimensions, outputAudioSampleRate, recompressesVideoAudio,
} from '../shared/encode.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { file, image, audio } from './helpers.js';

describe('targetDensity / targetBps', () => {
  it('divides density by the compression ratio', () => {
    const f = file('/a.mp4', 4000); // ≈1.93 b/px·s
    expect(targetDensity(f, DEFAULT_SETTINGS))
      .toBeCloseTo(1.929 / DEFAULT_SETTINGS.compressionRatio, 2);
    expect(targetBps(f, DEFAULT_SETTINGS))
      .toBe(Math.round(4_000_000 / DEFAULT_SETTINGS.compressionRatio));
  });
  it('clamps to min and max density', () => {
    const tiny = file('/a.mp4', 50); // density ≈ 0.024 < min 0.05
    expect(targetDensity(tiny, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.minDensity);
    const huge = file('/a.mp4', 200_000); // density/4 ≈ 24 > max 4
    expect(targetDensity(huge, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.maxDensity);
  });
  it('applies to audio via samples·channels', () => {
    const a = audio('/a.m4a', 256); // density 256000/96000 ≈ 2.67
    expect(targetBps(a, DEFAULT_SETTINGS))
      .toBe(Math.round(256_000 / DEFAULT_SETTINGS.compressionRatio));
  });
  it('applies density to constrained output dimensions', () => {
    const f = file('/a.mp4', 4000);
    const s = { ...DEFAULT_SETTINGS, maxWidth: 960 };
    expect(outputDimensions(f, s)).toEqual({ width: 960, height: 540 });
    expect(targetBps(f, s))
      .toBe(Math.round(4_000_000 / DEFAULT_SETTINGS.compressionRatio / 4));
    expect(estimatedSize(f, s))
      .toBeCloseTo(f.size / DEFAULT_SETTINGS.compressionRatio / 4);
  });
  it('applies density to a limited audio sample rate', () => {
    const f = audio('/a.wav', 256, 48000, 2);
    const s = { ...DEFAULT_SETTINGS, maxSampleRate: 24000 };
    expect(outputAudioSampleRate(f, s)).toBe(24000);
    expect(targetBps(f, s))
      .toBe(Math.round(256_000 / DEFAULT_SETTINGS.compressionRatio / 2));
  });
});

describe('effortToPreset', () => {
  it('maps av1 effort to an SVT preset number', () => {
    expect(effortToPreset('av1', 6)).toBe('6');
    expect(effortToPreset('av1', 10)).toBe('2');
  });
  it('maps x264/x265 effort to a named preset', () => {
    expect(effortToPreset('h264', 5)).toBe('medium');
  });
});

describe('outputExt', () => {
  it('depends on kind and settings', () => {
    expect(outputExt('video', DEFAULT_SETTINGS)).toBe('.mkv');
    expect(outputExt('image', DEFAULT_SETTINGS)).toBe('.webp');
    expect(outputExt('image', { ...DEFAULT_SETTINGS, imageFormat: 'jpeg' })).toBe('.jpg');
    expect(outputExt('audio', DEFAULT_SETTINGS)).toBe('.opus');
    expect(outputExt('audio', { ...DEFAULT_SETTINGS, audioCodec: 'mp3' })).toBe('.mp3');
  });
});

describe('ffmpegArgs', () => {
  it('builds an svt-av1 command with target bitrate in bitrate mode', () => {
    const args = ffmpegArgs(file('/in/a.mp4', 4000), '/out/a.mkv', DEFAULT_SETTINGS);
    expect(args).toContain('libsvtav1');
    expect(args[args.indexOf('-b:v') + 1])
      .toBe(`${Math.round(4000 / DEFAULT_SETTINGS.compressionRatio)}k`);
    expect(args.at(-1)).toBe('/out/a.mkv');
  });
  it('passes embedded video audio through when there is no applicable limit', () => {
    const f = file('/in/a.mp4', 4000, { sampleRate: 44100 });
    const unlimited = ffmpegArgs(f, '/out/a.mkv', DEFAULT_SETTINGS);
    expect(unlimited.slice(unlimited.indexOf('-c:a'), unlimited.indexOf('-c:a') + 2))
      .toEqual(['-c:a', 'copy']);
    const aboveSource = { ...DEFAULT_SETTINGS, maxSampleRate: 48000 };
    expect(recompressesVideoAudio(f, aboveSource)).toBe(false);
    expect(ffmpegArgs(f, '/out/a.mkv', aboveSource)).toContain('copy');
  });
  it('recompresses embedded audio when the limit equals the source rate', () => {
    const f = file('/in/a.mp4', 4000, { sampleRate: 44100, audioKbps: 128 });
    const s = { ...DEFAULT_SETTINGS, maxSampleRate: 44100 };
    const args = ffmpegArgs(f, '/out/a.mkv', s);
    expect(recompressesVideoAudio(f, s)).toBe(true);
    expect(args[args.indexOf('-c:a') + 1]).toBe('libopus');
    expect(args[args.indexOf('-ar') + 1]).toBe('24000');
    expect(args).toContain('-b:a');
  });
  it('adds a scale filter for constrained videos and images', () => {
    const s = { ...DEFAULT_SETTINGS, maxWidth: 1280, maxHeight: 720 };
    const videoArgs = ffmpegArgs(file('/in/a.mp4'), '/out/a.mkv', s);
    expect(videoArgs[videoArgs.indexOf('-vf') + 1]).toBe('scale=1280:720');
    const imageArgs = ffmpegArgs(
      image('/in/a.jpg', 1e6, 4000, 3000), '/out/a.webp', s);
    expect(imageArgs[imageArgs.indexOf('-vf') + 1]).toBe('scale=960:720');
  });
  it('uses CRF for video in quality mode', () => {
    const s = { ...DEFAULT_SETTINGS, rateMode: 'quality' as const, quality: 75 };
    const args = ffmpegArgs(file('/in/a.mp4'), '/out/a.mkv', s);
    expect(args).not.toContain('-b:v');
    expect(args[args.indexOf('-crf') + 1]).toBe('16'); // 63*(1-0.75) ≈ 16
  });
  it('always uses quality for images', () => {
    const args = ffmpegArgs(image('/in/a.png', 1e6), '/out/a.webp', DEFAULT_SETTINGS);
    expect(args).toContain('libwebp');
    expect(args[args.indexOf('-quality') + 1]).toBe('75');
    expect(args).toContain('-frames:v');
  });
  it('audio: opus falls back to bitrate even in quality mode', () => {
    const s = { ...DEFAULT_SETTINGS, rateMode: 'quality' as const };
    expect(supportsQualityMode('audio', s)).toBe(false);
    const args = ffmpegArgs(audio('/in/a.wav', 256), '/out/a.opus', s);
    expect(args).toContain('libopus');
    expect(args[args.indexOf('-b:a') + 1])
      .toBe(`${Math.round(256 / DEFAULT_SETTINGS.compressionRatio)}k`);
  });
  it('audio: mp3 quality mode uses -q:a', () => {
    const s = { ...DEFAULT_SETTINGS, rateMode: 'quality' as const, audioCodec: 'mp3' as const };
    const args = ffmpegArgs(audio('/in/a.wav'), '/out/a.mp3', s);
    expect(args[args.indexOf('-q:a') + 1]).toBe('2'); // 9*(1-0.75) ≈ 2
  });
});
