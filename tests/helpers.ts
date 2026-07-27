import { vi } from 'vitest';
import type { JobState, MediaFileInfo } from '../shared/types.js';
import { AppStateStore } from '../server/state.js';

/** A 1080p30 60s video whose size matches the given bitrate. */
export function file(path: string, kbps = 2000, extra: Partial<MediaFileInfo> = {}): MediaFileInfo {
  return {
    path, rootFolder: '/in', kind: 'video', width: 1920, height: 1080, fps: 30,
    sampleRate: 48000, channels: 2, audioKbps: 128,
    kbps, size: kbps * 125 * 60, duration: 60,
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
    sampleRate, channels, audioKbps: kbps,
    kbps, size: kbps * 125 * 60, duration: 60, codec: 'opus',
  };
}

export function fakeFetch(scanResult: MediaFileInfo[] = []) {
  let jobs: JobState[] = [];
  const queue = {
    getStates: () => jobs,
    setMaxConcurrent: vi.fn(),
    unqueue: vi.fn((path: string) => {
      const job = jobs.find(candidate => candidate.path === path);
      if (job?.status === 'enqueued') {
        job.status = 'notQueued';
        job.progress = 0;
      }
    }),
    clear: vi.fn((paths: string[]) => {
      const removed = new Set(paths);
      jobs = jobs.filter(job => !removed.has(job.path));
    }),
  };
  const scan = vi.fn(async (
    _folder: string, _output: string, _exclusions: string[], extensions: string[] = [],
  ) => scanResult.filter(info =>
    extensions.some(ext => info.path.toLowerCase().endsWith(ext))));
  const store = new AppStateStore(queue, scan, () => true);
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === '/api/state' && !init?.method)
      return response(store.snapshot());
    if (path === '/api/state') {
      try {
        const snapshot = await store.dispatch(body.command, body.revision);
        const structural = ['addFolder', 'rescan', 'clearAll', 'clearUnqueued']
          .includes(body.command?.type);
        return response(structural ? snapshot : { revision: snapshot.revision });
      } catch (error: any) {
        return response({ error: String(error.message ?? error) }, 409);
      }
    }
    if (path === '/api/enqueue') {
      const request = store.enqueueRequest(body.paths ?? []);
      for (const entry of request.files) {
        jobs = jobs.filter(job => job.path !== entry.info.path);
        jobs.push({ path: entry.info.path, status: 'enqueued', progress: 0 });
      }
      return response({ ok: true });
    }
    if (path === '/api/unqueue') {
      for (const item of body.paths ?? []) queue.unqueue(item);
      return response({ ok: true });
    }
    return response({ ok: true });
  }) as any;
  fetcher.scan = scan;
  fetcher.setJobs = (states: JobState[]) => {
    jobs = states.map(state => ({ ...state }));
  };
  return fetcher as typeof fetch & {
    scan: typeof scan;
    setJobs(states: JobState[]): void;
  };
}

function response(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Conflict',
    json: async () => structuredClone(data),
  };
}
