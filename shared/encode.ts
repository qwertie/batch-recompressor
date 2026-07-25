import type { EncodeSettings, MediaFileInfo, MediaKind } from './types.js';

/**
 * The "pixel-equivalent" count that normalizes size across media types:
 * video = pixels·seconds, image = pixels, audio = samples·channels.
 */
export function denominator(f: MediaFileInfo): number {
  if (f.kind === 'video') return f.width * f.height * f.duration;
  if (f.kind === 'image') return f.width * f.height;
  return f.sampleRate * f.channels * f.duration;
}

/** Normalized compression density (bits per pixel·second / pixel / sample). ~1 is typical. */
export function density(f: MediaFileInfo): number {
  const d = denominator(f);
  return d > 0 ? (f.size * 8) / d : 0;
}

/** Unit label for a media kind's density. */
export function densityUnit(kind: MediaKind): string {
  return kind === 'video' ? 'b/px·s' : kind === 'image' ? 'b/px' : 'b/smp';
}

/** Target density after applying the compression ratio, clamped to min/max. */
export function targetDensity(f: MediaFileInfo, s: EncodeSettings): number {
  return Math.min(s.maxDensity, Math.max(s.minDensity, density(f) / s.compressionRatio));
}

/** Target stream bitrate in bps for video/audio (bitrate mode). */
export function targetBps(f: MediaFileInfo, s: EncodeSettings): number {
  return Math.round(targetDensity(f, s) * denominator(f) / Math.max(0.001, f.duration));
}

/** Estimated output size in bytes (any kind, for UI display). */
export function estimatedSize(f: MediaFileInfo, s: EncodeSettings): number {
  return targetDensity(f, s) * denominator(f) / 8;
}

/** Map effort 0..10 to an encoder-specific speed preset. */
export function effortToPreset(codec: EncodeSettings['videoCodec'], effort: number): string {
  const e = Math.min(10, Math.max(0, Math.round(effort)));
  if (codec === 'av1') return String(12 - e); // SVT-AV1: 0 (slowest) .. 13 (fastest)
  const x264 = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast',
    'medium', 'slow', 'slow', 'slower', 'veryslow', 'veryslow'];
  return x264[e];
}

/** Output file extension for a media kind under the given settings. */
export function outputExt(kind: MediaKind, s: EncodeSettings): string {
  if (kind === 'video') return '.mkv';
  if (kind === 'image')
    return { webp: '.webp', jpeg: '.jpg', avif: '.avif' }[s.imageFormat];
  return { opus: '.opus', aac: '.m4a', mp3: '.mp3' }[s.audioCodec];
}

/** True if quality mode actually works for this file's codec choice. */
export function supportsQualityMode(kind: MediaKind, s: EncodeSettings): boolean {
  return !(kind === 'audio' && s.audioCodec === 'opus'); // opus is bitrate-driven
}

/** Build the ffmpeg argument list (excluding the ffmpeg binary itself). */
export function ffmpegArgs(f: MediaFileInfo, output: string, s: EncodeSettings): string[] {
  const args = ['-y', '-i', f.path];
  const q = Math.min(100, Math.max(0, s.quality));
  const useQuality = f.kind === 'image'
    || (s.rateMode === 'quality' && supportsQualityMode(f.kind, s));

  if (f.kind === 'video') {
    const vcodec = { av1: 'libsvtav1', hevc: 'libx265', h264: 'libx264' }[s.videoCodec];
    args.push('-c:v', vcodec, '-preset', effortToPreset(s.videoCodec, s.effort));
    if (useQuality) {
      // Map 0..100 quality onto the codec's CRF scale (lower CRF = better).
      const maxCrf = s.videoCodec === 'av1' ? 63 : 51;
      args.push('-crf', String(Math.round(maxCrf * (1 - q / 100))));
    } else {
      args.push('-b:v', `${Math.round(targetBps(f, s) / 1000)}k`);
    }
    args.push('-c:a', 'libopus', '-b:a', '96k');
  } else if (f.kind === 'image') {
    if (s.imageFormat === 'webp') args.push('-c:v', 'libwebp', '-quality', String(q));
    else if (s.imageFormat === 'jpeg')
      args.push('-c:v', 'mjpeg', '-q:v', String(Math.round(2 + 29 * (1 - q / 100))));
    else args.push('-c:v', 'libaom-av1', '-still-picture', '1',
      '-crf', String(Math.round(63 * (1 - q / 100))));
    args.push('-frames:v', '1');
  } else {
    const acodec = { opus: 'libopus', aac: 'aac', mp3: 'libmp3lame' }[s.audioCodec];
    args.push('-vn', '-c:a', acodec);
    if (useQuality) {
      if (s.audioCodec === 'mp3') args.push('-q:a', String(Math.round(9 * (1 - q / 100))));
      else args.push('-q:a', (0.1 + 1.9 * q / 100).toFixed(2)); // native aac VBR 0.1..2
    } else {
      args.push('-b:a', `${Math.round(targetBps(f, s) / 1000)}k`);
    }
  }
  args.push('-progress', 'pipe:1', '-nostats', output);
  return args;
}
