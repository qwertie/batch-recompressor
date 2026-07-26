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

/** Normalized compression density (bits/second/pixel / pixel / sample). ~1 is typical. */
export function density(f: MediaFileInfo): number {
  const d = denominator(f);
  return d > 0 ? (f.size * 8) / d : 0;
}

/** Output dimensions after applying optional limits without upscaling. */
export function outputDimensions(
  f: MediaFileInfo, s: EncodeSettings,
): { width: number; height: number } {
  if (f.kind === 'audio' || f.width <= 0 || f.height <= 0)
    return { width: f.width, height: f.height };
  const widthScale = s.maxWidth > 0 ? s.maxWidth / f.width : 1;
  const heightScale = s.maxHeight > 0 ? s.maxHeight / f.height : 1;
  const scale = Math.min(1, widthScale, heightScale);
  if (scale >= 1) return { width: f.width, height: f.height };
  return {
    width: Math.max(2, Math.floor(f.width * scale / 2) * 2),
    height: Math.max(2, Math.floor(f.height * scale / 2) * 2),
  };
}

const AUDIO_SAMPLE_RATES: Record<EncodeSettings['audioCodec'], number[]> = {
  opus: [48000, 24000, 16000, 12000, 8000],
  aac: [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000],
  mp3: [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000],
};

/** Codec-supported sample rate closest to the source without exceeding the limit. */
export function outputAudioSampleRate(f: MediaFileInfo, s: EncodeSettings): number {
  if (f.sampleRate <= 0) return 0;
  if (s.maxSampleRate <= 0) return f.sampleRate;
  const allowed = AUDIO_SAMPLE_RATES[s.audioCodec]
    .filter(rate => rate <= s.maxSampleRate);
  if (allowed.length === 0) return AUDIO_SAMPLE_RATES[s.audioCodec].at(-1)!;
  return allowed.reduce((best, rate) =>
    Math.abs(rate - f.sampleRate) < Math.abs(best - f.sampleRate) ? rate : best);
}

/** True when embedded video audio must be re-encoded instead of copied. */
export function recompressesVideoAudio(f: MediaFileInfo, s: EncodeSettings): boolean {
  return f.kind === 'video' && f.sampleRate > 0
    && s.maxSampleRate > 0 && s.maxSampleRate <= f.sampleRate;
}

/** Unit label for a media kind's density. */
export function densityUnit(kind: MediaKind): string {
  return kind === 'video' ? 'b/s/px' : kind === 'image' ? 'b/px' : 'b/smp';
}

/** Target density after applying the compression ratio, clamped to min/max. */
export function targetDensity(f: MediaFileInfo, s: EncodeSettings): number {
  return Math.min(s.maxDensity, Math.max(s.minDensity, density(f) / s.compressionRatio));
}

/** Pixel/sample denominator after applying output limits. */
export function targetDenominator(f: MediaFileInfo, s: EncodeSettings): number {
  if (f.kind === 'video') {
    const { width, height } = outputDimensions(f, s);
    return width * height * f.duration;
  }
  if (f.kind === 'image') {
    const { width, height } = outputDimensions(f, s);
    return width * height;
  }
  return outputAudioSampleRate(f, s) * f.channels * f.duration;
}

/** Target stream bitrate in bps for video/audio (bitrate mode). */
export function targetBps(f: MediaFileInfo, s: EncodeSettings): number {
  return Math.round(targetDensity(f, s) * targetDenominator(f, s)
    / Math.max(0.001, f.duration));
}

/** Estimated output size in bytes (any kind, for UI display). */
export function estimatedSize(f: MediaFileInfo, s: EncodeSettings): number {
  return targetDensity(f, s) * targetDenominator(f, s) / 8;
}

function targetEmbeddedAudioBps(f: MediaFileInfo, s: EncodeSettings): number {
  const sourceRate = Math.max(1, f.sampleRate * f.channels);
  const sourceDensity = ((f.audioKbps || 96) * 1000) / sourceRate;
  const targetAudioDensity = Math.min(
    s.maxDensity, Math.max(s.minDensity, sourceDensity / s.compressionRatio));
  return Math.round(targetAudioDensity * outputAudioSampleRate(f, s) * f.channels);
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
    const dims = outputDimensions(f, s);
    if (dims.width !== f.width || dims.height !== f.height)
      args.push('-vf', `scale=${dims.width}:${dims.height}`);
    if (recompressesVideoAudio(f, s)) {
      const acodec = { opus: 'libopus', aac: 'aac', mp3: 'libmp3lame' }[s.audioCodec];
      args.push('-c:a', acodec, '-ar', String(outputAudioSampleRate(f, s)));
      if (s.rateMode === 'quality' && supportsQualityMode('audio', s)) {
        if (s.audioCodec === 'mp3')
          args.push('-q:a', String(Math.round(9 * (1 - q / 100))));
        else args.push('-q:a', (0.1 + 1.9 * q / 100).toFixed(2));
      } else {
        args.push('-b:a', `${Math.round(targetEmbeddedAudioBps(f, s) / 1000)}k`);
      }
    } else {
      args.push('-c:a', 'copy');
    }
  } else if (f.kind === 'image') {
    if (s.imageFormat === 'webp') args.push('-c:v', 'libwebp', '-quality', String(q));
    else if (s.imageFormat === 'jpeg')
      args.push('-c:v', 'mjpeg', '-q:v', String(Math.round(2 + 29 * (1 - q / 100))));
    else args.push('-c:v', 'libaom-av1', '-still-picture', '1',
      '-crf', String(Math.round(63 * (1 - q / 100))));
    const dims = outputDimensions(f, s);
    if (dims.width !== f.width || dims.height !== f.height)
      args.push('-vf', `scale=${dims.width}:${dims.height}`);
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
    if (s.maxSampleRate > 0)
      args.push('-ar', String(outputAudioSampleRate(f, s)));
  }
  args.push('-progress', 'pipe:1', '-nostats', output);
  return args;
}
