import { describe, expect, it } from 'vitest';
import { displayDimensions, streamRotation } from '../server/scan.js';

describe('rotation metadata', () => {
  it('prefers ffprobe display-matrix side data and normalizes its angle', () => {
    expect(streamRotation({
      tags: { rotate: '180' },
      side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
    })).toBe(270);
  });

  it('supports legacy rotate tags', () => {
    expect(streamRotation({ tags: { rotate: '90' } })).toBe(90);
  });

  it('swaps display dimensions for quarter turns', () => {
    expect(displayDimensions(3840, 2160, 90)).toEqual({ width: 2160, height: 3840 });
    expect(displayDimensions(3840, 2160, 270)).toEqual({ width: 2160, height: 3840 });
    expect(displayDimensions(3840, 2160, 180)).toEqual({ width: 3840, height: 2160 });
  });
});
