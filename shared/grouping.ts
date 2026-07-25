import type { MediaFileInfo } from './types.js';
import { density, densityUnit } from './encode.js';

export interface FileGroup {
  /** e.g. "1920x1080x30 ~0.92 b/px·s" */
  label: string;
  key: string;
  /** Representative (median) density of the group. */
  density: number;
  files: MediaFileInfo[];
}

export interface GroupingOptions {
  /** Split video/image groups by resolution (and audio by sample rate/channels). */
  byResolution: boolean;
  /** Split video groups by rounded framerate. */
  byFps: boolean;
}

export const DEFAULT_GROUPING: GroupingOptions = { byResolution: true, byFps: true };

/** Round fps for grouping purposes (29.97 -> 30, 23.976 -> 24). */
export function roundFps(fps: number): number {
  return Math.round(fps);
}

function bucketLabel(f: MediaFileInfo, o: GroupingOptions): string {
  if (f.kind === 'audio') {
    const ch = f.channels === 1 ? 'mono' : f.channels === 2 ? 'stereo' : `${f.channels}ch`;
    return 'audio' + (o.byResolution ? ` ${Math.round(f.sampleRate / 1000)}kHz ${ch}` : '');
  }
  const res = o.byResolution ? ` ${f.width}x${f.height}` : '';
  if (f.kind === 'image') return 'image' + res;
  return o.byResolution || o.byFps
    ? `${res.trim()}${o.byFps ? (res ? 'x' : 'video ') + roundFps(f.fps) : ''}`
    : 'video';
}

/**
 * Group files by kind (+resolution/fps per options), then split each bucket
 * into density clusters such that no two files in one cluster differ by more
 * than 30% (max <= min * 1.3), using greedy clustering over sorted densities.
 */
export function groupFiles(
  files: MediaFileInfo[], options: GroupingOptions = DEFAULT_GROUPING,
): FileGroup[] {
  const buckets = new Map<string, MediaFileInfo[]>();
  for (const f of files) {
    const key = bucketLabel(f, options);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(f);
  }

  const groups: FileGroup[] = [];
  for (const [label, bucket] of buckets) {
    bucket.sort((a, b) => density(a) - density(b));
    let cluster: MediaFileInfo[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const d = density(cluster[Math.floor(cluster.length / 2)]);
      const shown = d >= 10 ? Math.round(d) : d.toFixed(2);
      groups.push({
        label: `${label} ~${shown} ${densityUnit(cluster[0].kind)}`,
        key: `${label}@${shown}`,
        density: d,
        files: cluster,
      });
      cluster = [];
    };
    for (const f of bucket) {
      if (cluster.length > 0 && density(f) > density(cluster[0]) * 1.3) flush();
      cluster.push(f);
    }
    flush();
  }

  const kindOrder = { video: 0, image: 1, audio: 2 };
  groups.sort((a, b) =>
    kindOrder[a.files[0].kind] - kindOrder[b.files[0].kind]
    || b.files[0].width * b.files[0].height - a.files[0].width * a.files[0].height
    || b.density - a.density);
  return groups;
}
