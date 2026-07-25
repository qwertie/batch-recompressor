import { describe, it, expect } from 'vitest';
import { outputPathFor, isExcluded, isInside, normPath } from '../shared/paths.js';

describe('normPath', () => {
  it('converts backslashes and strips trailing slash', () => {
    expect(normPath('C:\\A\\B\\')).toBe('C:/A/B');
    expect(normPath('/x/y/')).toBe('/x/y');
  });
});

describe('isInside', () => {
  it('detects containment and equality', () => {
    expect(isInside('C:/A/B/c.mp4', 'C:\\A\\B')).toBe(true);
    expect(isInside('C:/A/B', 'C:/A/B')).toBe(true);
    expect(isInside('C:/A/Bx/c.mp4', 'C:/A/B')).toBe(false);
  });
});

describe('outputPathFor', () => {
  it('mirrors the input structure under the output folder', () => {
    // The example from the spec: root C:\A\B, file C:\A\B\C\D.mp4 -> C:\Out\C\D.*
    expect(outputPathFor('C:\\A\\B\\C\\D.mp4', 'C:\\A\\B', 'C:\\OutputFolder'))
      .toBe('C:/OutputFolder/C/D.mkv');
  });
  it('works with posix paths and replaces the extension', () => {
    expect(outputPathFor('/in/x/y.avi', '/in', '/out')).toBe('/out/x/y.mkv');
  });
  it('throws if the file is not under the root', () => {
    expect(() => outputPathFor('/other/y.avi', '/in', '/out')).toThrow();
  });
});

describe('isExcluded', () => {
  it('implicitly excludes the output folder', () => {
    expect(isExcluded('/out/sub/a.mp4', '/out', [])).toBe(true);
    expect(isExcluded('/in/a.mp4', '/out', [])).toBe(false);
  });
  it('honors the exclusion list for files and folders', () => {
    expect(isExcluded('/in/skip/a.mp4', '/out', ['/in/skip'])).toBe(true);
    expect(isExcluded('/in/a.mp4', '/out', ['/in/a.mp4'])).toBe(true);
    expect(isExcluded('/in/b.mp4', '/out', ['/in/a.mp4'])).toBe(false);
  });
});
