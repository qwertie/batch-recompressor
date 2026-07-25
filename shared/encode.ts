import type { EncodeSettings } from './types.js';

/** Compute the target video bitrate (kbps) for a file, clamped to min/max. */
export function targetKbps(sourceKbps: number, s: EncodeSettings): number {
  const t = sourceKbps / s.compressionRatio;
  return Math.round(Math.min(s.maxKbps, Math.max(s.minKbps, t)));
}

/** Map effort 0..10 to an encoder-specific speed preset. */
export function effortToPreset(codec: EncodeSettings['codec'], effort: number): string {
  const e = Math.min(10, Math.max(0, Math.round(effort)));
  if (codec === 'av1') return String(12 - e); // SVT-AV1: 0 (slowest) .. 13 (fastest)
  const x264 = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
    'medium', 'slow', 'slow', 'slower', 'veryslow', 'veryslow'];
  return x264[e];
}

/** Build the ffmpeg argument list (excluding the ffmpeg binary itself). */
export function ffmpegArgs(
  input: string, output: string, sourceKbps: number, s: EncodeSettings,
): string[] {
  const kbps = targetKbps(sourceKbps, s);
  const vcodec = s.codec === 'av1' ? 'libsvtav1' : s.codec === 'hevc' ? 'libx265' : 'libx264';
  const args = ['-y', '-i', input, '-c:v', vcodec, '-b:v', `${kbps}k`];
  if (s.codec === 'av1') args.push('-preset', effortToPreset('av1', s.effort));
  else args.push('-preset', effortToPreset(s.codec, s.effort));
  args.push('-c:a', 'libopus', '-b:a', '96k', '-progress', 'pipe:1', '-nostats', output);
  return args;
}
