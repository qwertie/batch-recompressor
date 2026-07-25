import { describe, it, expect } from 'vitest';
import { groupFiles, roundFps } from '../shared/grouping.js';
import type { VideoFileInfo } from '../shared/types.js';

function file(path: string, kbps: number, width = 1920, height = 1080, fps = 30): VideoFileInfo {
  return {
    path, rootFolder: '/root', width, height, fps, kbps,
    size: kbps * 125 * 60, duration: 60, codec: 'h264',
  };
}

describe('roundFps', () => {
  it('rounds NTSC rates to whole numbers', () => {
    expect(roundFps(29.97)).toBe(30);
    expect(roundFps(23.976)).toBe(24);
    expect(roundFps(60)).toBe(60);
  });
});

describe('groupFiles', () => {
  it('separates by resolution', () => {
    const groups = groupFiles([file('/root/a.mp4', 2000), file('/root/b.mp4', 2000, 1280, 720)]);
    expect(groups).toHaveLength(2);
  });

  it('separates by rounded fps', () => {
    const groups = groupFiles([
      file('/root/a.mp4', 2000, 1920, 1080, 29.97),
      file('/root/b.mp4', 2000, 1920, 1080, 60),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.label).some(l => l.includes('1920x1080x30'))).toBe(true);
  });

  it('keeps bitrates within 30% together', () => {
    const groups = groupFiles([file('/root/a.mp4', 2000), file('/root/b.mp4', 2500)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(2);
  });

  it('splits bitrates more than 30% apart', () => {
    const groups = groupFiles([file('/root/a.mp4', 2000), file('/root/b.mp4', 2700)]);
    expect(groups).toHaveLength(2);
  });

  it('clusters greedily over sorted bitrates', () => {
    // 1000, 1250 group; 1700, 2000 group; 5000 alone
    const groups = groupFiles([
      file('/a.mp4', 1700), file('/b.mp4', 1000), file('/c.mp4', 5000),
      file('/d.mp4', 1250), file('/e.mp4', 2000),
    ].map(f => ({ ...f, rootFolder: '/' })));
    const sizes = groups.map(g => g.files.length).sort();
    expect(sizes).toEqual([1, 2, 2]);
  });

  it('labels groups like "1920x1080x30 ~2204 kbps"', () => {
    const groups = groupFiles([file('/root/a.mp4', 2204)]);
    expect(groups[0].label).toBe('1920x1080x30 ~2204 kbps');
  });
});
