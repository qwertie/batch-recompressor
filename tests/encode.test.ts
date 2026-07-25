import { describe, it, expect } from 'vitest';
import { targetKbps, ffmpegArgs, effortToPreset } from '../shared/encode.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';

describe('targetKbps', () => {
  it('divides by the compression ratio', () => {
    expect(targetKbps(4000, DEFAULT_SETTINGS)).toBe(1000);
  });
  it('clamps to min and max', () => {
    expect(targetKbps(400, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.minKbps);
    expect(targetKbps(1e6, DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS.maxKbps);
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

describe('ffmpegArgs', () => {
  it('builds an svt-av1 command with target bitrate', () => {
    const args = ffmpegArgs('/in/a.mp4', '/out/a.mkv', 4000, DEFAULT_SETTINGS);
    expect(args).toContain('libsvtav1');
    expect(args).toContain('-b:v');
    expect(args[args.indexOf('-b:v') + 1]).toBe('1000k');
    expect(args.at(-1)).toBe('/out/a.mkv');
  });
});
