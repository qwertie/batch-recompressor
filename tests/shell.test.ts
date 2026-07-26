import { describe, expect, it } from 'vitest';
import { explorerSelectArgument } from '../server/shell.js';

describe('Windows Explorer integration', () => {
  it('keeps the select switch and quoted path in one argument', () => {
    expect(explorerSelectArgument('C:\\Users\\David\\My Videos\\clip.mp4'))
      .toBe('/select,"C:\\Users\\David\\My Videos\\clip.mp4"');
  });

  it('converts generated output paths to Windows separators', () => {
    expect(explorerSelectArgument('C:/Users/David/My Videos/clip.mkv'))
      .toBe('/select,"C:\\Users\\David\\My Videos\\clip.mkv"');
  });
});
