// Types shared between server and client.

export interface VideoFileInfo {
  /** Absolute path of the source file. */
  path: string;
  /** The root folder (as added via "Add folder") this file was found under. */
  rootFolder: string;
  width: number;
  height: number;
  /** Frames per second, rounded to 3 decimals. */
  fps: number;
  /** Overall bitrate in kbps. */
  kbps: number;
  /** File size in bytes. */
  size: number;
  /** Duration in seconds. */
  duration: number;
  codec: string;
}

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

export interface EncodeSettings {
  /** Target size ratio: output should be ~originalSize / ratio. */
  compressionRatio: number;
  minKbps: number;
  maxKbps: number;
  codec: 'av1' | 'hevc' | 'h264';
  /** 0 (fastest) .. 10 (slowest/best). */
  effort: number;
}

/** Per-group / per-file overrides: any subset of EncodeSettings. */
export type SettingsOverride = Partial<EncodeSettings>;

export const DEFAULT_SETTINGS: EncodeSettings = {
  compressionRatio: 4,
  minKbps: 300,
  maxKbps: 8000,
  codec: 'av1',
  effort: 6,
};

export interface EnqueueRequest {
  /** If false (default), files whose output already exists are marked finished. */
  overwrite?: boolean;
  files: {
    path: string;
    rootFolder: string;
    settings: EncodeSettings;
    kbps: number;
  }[];
  outputFolder: string;
}
