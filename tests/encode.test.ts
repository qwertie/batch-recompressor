import { describe, it, expect } from 'vitest';
import {
  targetBps, targetDensity, ffmpegArgs, effortToPreset, outputExt, supportsQualityMode,
} from '../shared/encode.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { file, image, audio } from './helpers.js';

describe('targetDensity / targetBps', () => {
  it('divides density by the compression ratio', () => {
    const f = file('/a.mp4', 4000); // ≈1.93 b/px·s
    expect(targetDensity(f, DEFAULT_SETTINGS)).toBeCloseTo(1.929 / 4, 2);
    expect(targetBps(f, DEFAULT_SETTINGS)).toBe(1_000_000);
  });
  it('clamps to min and max density', () => {
    const tiny = file('/a.mp4', 50); // density ≈ 0.024 < min 0.05
    expect(targetDensity(tiny, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.minDensity);
    const huge = file('/a.mp4', 200_000); // density/4 ≈ 24 > max 4
    expect(targetDensity(huge, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.maxDensity);
  });
  it('applies to audio via samples·channels', () => {
    const a = audio('/a.m4a', 256); // density 256000/96000 ≈ 2.67
    expect(targetBps(a, DEFAULT_SETTINGS)).toBe(64_000); // /4
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
    expect(args[args.indexOf('-b:v') + 1]).toBe('1000k');
    expect(args.at(-1)).toBe('/out/a.mkv');
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
    expect(args[args.indexOf('-b:a') + 1]).toBe('64k');
  });
  it('audio: mp3 quality mode uses -q:a', () => {
    const s = { ...DEFAULT_SETTINGS, rateMode: 'quality' as const, audioCodec: 'mp3' as const };
    const args = ffmpegArgs(audio('/in/a.wav'), '/out/a.mp3', s);
    expect(args[args.indexOf('-q:a') + 1]).toBe('2'); // 9*(1-0.75) ≈ 2
  });
});
