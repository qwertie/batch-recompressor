// Types shared between server and client.

export type MediaKind = 'video' | 'image' | 'audio';

export interface MediaFileInfo {
  /** Absolute path of the source file. */
  path: string;
  /** The root folder (as added via "Add folder") this file was found under. */
  rootFolder: string;
  kind: MediaKind;
  /** Video/image dimensions; 0 for audio. */
  width: number;
  height: number;
  /** Frames per second, rounded to 3 decimals; 0 for image/audio. */
  fps: number;
  /** Audio-stream sample rate and channels; 0 when there is no audio stream. */
  sampleRate: number;
  channels: number;
  /** Audio-stream bitrate in kbps, including embedded video audio when known. */
  audioKbps?: number;
  /** Overall bitrate in kbps (0 for images). */
  kbps: number;
  /** File size in bytes. */
  size: number;
  /** Duration in seconds (0 for images). */
  duration: number;
  codec: string;
}

/** @deprecated old name, kept for less churn */
export type VideoFileInfo = MediaFileInfo;

export type JobStatus = 'notQueued' | 'enqueued' | 'processing' | 'finished' | 'error';

export interface JobState {
  path: string;
  status: JobStatus;
  /** 0..1 while processing. */
  progress: number;
  error?: string;
  outputPath?: string;
  outputSize?: number;
}

export type RateMode = 'bitrate' | 'quality';

export interface EncodeSettings {
  /** Target size ratio: output should be ~originalSize / ratio. */
  compressionRatio: number;
  /**
   * Min/max compression density in normalized units where ~1 is typical:
   * video = bits/(pixel·second), image = bits/pixel,
   * audio = bits/(sample·channel). Used in bitrate mode.
   */
  minDensity: number;
  maxDensity: number;
  /** Prefer a target bitrate (n/a for images) or a quality setting. */
  rateMode: RateMode;
  /** 0 (worst) .. 100 (best); used in quality mode and always for images. */
  quality: number;
  videoCodec: 'av1' | 'hevc' | 'h264';
  imageFormat: 'webp' | 'jpeg' | 'avif';
  audioCodec: 'opus' | 'aac' | 'mp3';
  /** 0 (fastest) .. 10 (slowest/best). */
  effort: number;
  /** Maximum output dimensions; 0 means unlimited. */
  maxWidth: number;
  maxHeight: number;
  /** Maximum output audio sample rate in Hz; 0 means unlimited. */
  maxSampleRate: number;
}

/** Per-group / per-file overrides: any subset of EncodeSettings. */
export type SettingsOverride = Partial<EncodeSettings>;

export const DEFAULT_SETTINGS: EncodeSettings = {
  compressionRatio: 3,
  minDensity: 0.1,
  maxDensity: 10,
  rateMode: 'bitrate',
  quality: 75,
  videoCodec: 'av1',
  imageFormat: 'webp',
  audioCodec: 'opus',
  effort: 6,
  maxWidth: 0,
  maxHeight: 0,
  maxSampleRate: 0,
};

export interface EnqueueRequest {
  /** If false (default), files whose output already exists are marked finished. */
  overwrite?: boolean;
  files: {
    info: MediaFileInfo;
    settings: EncodeSettings;
  }[];
  outputFolder: string;
}
