import { describe, it, expect } from 'vitest';
import { groupFiles, roundFps } from '../shared/grouping.js';
import { density } from '../shared/encode.js';
import { file, image, audio } from './helpers.js';

describe('roundFps', () => {
  it('rounds NTSC rates to whole numbers', () => {
    expect(roundFps(29.97)).toBe(30);
    expect(roundFps(23.976)).toBe(24);
    expect(roundFps(60)).toBe(60);
  });

  it('snaps variable rates to 6-fps grouping buckets', () => {
    expect(roundFps(26)).toBe(24);
    expect(roundFps(27)).toBe(30);
    expect(roundFps(22)).toBe(24);
  });
});

describe('density', () => {
  it('is bits per second per pixel for video', () => {
    // 2000 kbps at 1920x1080 -> 2,000,000 / 2,073,600 ≈ 0.965
    expect(density(file('/a.mp4', 2000))).toBeCloseTo(0.9645, 3);
  });
  it('is bits per pixel for images', () => {
    expect(density(image('/a.jpg', 1_000_000, 4000, 2000))).toBeCloseTo(1.0, 5);
  });
  it('is bits per sample·channel for audio', () => {
    // 96 kbps stereo 48kHz -> 96000/(48000*2) = 1.0
    expect(density(audio('/a.opus', 96))).toBeCloseTo(1.0, 5);
  });
});

describe('groupFiles', () => {
  it('separates by resolution when enabled', () => {
    const files = [file('/a.mp4', 2000),
      file('/b.mp4', 2000, { width: 1280, height: 720, size: 2000 * 125 * 60 })];
    expect(groupFiles(files)).toHaveLength(2);
  });

  it('can ignore resolution and framerate, grouping purely by density', () => {
    // Same density (b/s/px) at different resolutions
    const files = [file('/a.mp4', 2000),
      file('/b.mp4', 889, { width: 1280, height: 720, size: 2000 * 125 * 60 * (1280 * 720) / (1920 * 1080) })];
    const groups = groupFiles(files, { byResolution: false, byFps: false });
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(2);
  });

  it('separates by rounded fps when enabled', () => {
    const files = [file('/a.mp4', 2000, { fps: 29.97 }), file('/b.mp4', 2000, { fps: 60 })];
    const groups = groupFiles(files);
    expect(groups).toHaveLength(2);
    expect(groups.some(g => g.label.includes('1920x1080 ~30fps'))).toBe(true);
  });

  it('shows the measured average fps for each snapped group', () => {
    const groups = groupFiles([
      file('/a.mp4', 2000, { fps: 27 }),
      file('/b.mp4', 2000, { fps: 29 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toContain('1920x1080 ~28fps');
    expect(groups[0].label).toMatch(/\(2\)$/);
  });

  it('keeps densities within 25% together and splits beyond that', () => {
    expect(groupFiles([file('/a.mp4', 2000), file('/b.mp4', 2500)])).toHaveLength(1);
    expect(groupFiles([file('/a.mp4', 2000), file('/b.mp4', 2501)])).toHaveLength(2);
  });

  it('does not create adjacent clusters with nearly identical representatives', () => {
    const atDensity = (path: string, d: number) => file(path, d * 1920 * 1080 / 1000);
    const groups = groupFiles([
      atDensity('/a.mp4', 11.2),
      atDensity('/b.mp4', 14.0),
      atDensity('/c.mp4', 14.1),
      atDensity('/d.mp4', 15.0),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(4);
  });

  it('uses exact cluster anchors as keys rather than rounded display densities', () => {
    const atDensity = (path: string, d: number) => file(path, d * 1920 * 1080 / 1000);
    const groups = groupFiles([
      atDensity('/a.mp4', 10),
      atDensity('/b.mp4', 14),
    ]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map(g => g.key)).size).toBe(2);
  });

  it('never mixes media kinds in one group', () => {
    const groups = groupFiles([file('/a.mp4'), image('/b.jpg', 1e6), audio('/c.opus')],
      { byResolution: false, byFps: false });
    expect(groups).toHaveLength(3);
  });

  it('labels use the density unit of the kind', () => {
    const [v] = groupFiles([file('/a.mp4', 2000)]);
    expect(v.label).toBe('1920x1080 ~30fps ~0.96 b/s/px (1)');
    const [a] = groupFiles([audio('/a.opus', 96)]);
    expect(a.label).toBe('audio 48kHz stereo ~1.00 b/smp (1)');
    const [i] = groupFiles([image('/a.jpg', 1e6, 4000, 2000)]);
    expect(i.label).toBe('image 4000x2000 ~1.00 b/px (1)');
  });
});
