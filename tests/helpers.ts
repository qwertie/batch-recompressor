import { vi } from 'vitest';
import type { MediaFileInfo } from '../shared/types.js';

/** A 1080p30 60s video whose size matches the given bitrate. */
export function file(path: string, kbps = 2000, extra: Partial<MediaFileInfo> = {}): MediaFileInfo {
  return {
    path, rootFolder: '/in', kind: 'video', width: 1920, height: 1080, fps: 30,
    sampleRate: 0, channels: 0, kbps, size: kbps * 125 * 60, duration: 60,
    codec: 'h264', ...extra,
  };
}

export function image(path: string, size: number, width = 4032, height = 3024): MediaFileInfo {
  return {
    path, rootFolder: '/in', kind: 'image', width, height, fps: 0,
    sampleRate: 0, channels: 0, kbps: 0, size, duration: 0, codec: 'mjpeg',
  };
}

export function audio(path: string, kbps = 128, sampleRate = 48000, channels = 2): MediaFileInfo {
  return {
    path, rootFolder: '/in', kind: 'audio', width: 0, height: 0, fps: 0,
    sampleRate, channels, kbps, size: kbps * 125 * 60, duration: 60, codec: 'opus',
  };
}

export function fakeFetch(scanResult: MediaFileInfo[] = []) {
  return vi.fn(async (url: RequestInfo | URL) => ({
    ok: true,
    json: async () => (String(url).includes('/api/scan') ? scanResult : { ok: true }),
  })) as unknown as typeof fetch;
}
