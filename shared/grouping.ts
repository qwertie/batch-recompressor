import type { MediaFileInfo } from './types.js';
import { density, densityUnit } from './encode.js';

export interface FileGroup {
  /** e.g. "1920x1080 ~28.4fps ~0.92 b/px·s (17)" */
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
export const DENSITY_CLUSTER_GAP = 0.25;

/** Snap fps to 6-fps buckets for grouping (26 -> 24, 27 -> 30). */
export function roundFps(fps: number): number {
  return Math.round(fps / 6) * 6;
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
 * into data-anchored density clusters. A new cluster starts when the next
 * sorted file is more than 25% above the current cluster's median, so adjacent
 * cluster representatives are meaningfully separated without fixed bands.
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
      const averageFps = cluster[0].kind === 'video' && options.byFps
        ? cluster.reduce((sum, f) => sum + f.fps, 0) / cluster.length
        : 0;
      const displayLabel = averageFps
        ? label.replace(/x\d+$/, '').replace(/^video \d+$/, 'video')
        : label;
      const fpsDetail = averageFps
        ? ` ~${Number(averageFps.toFixed(1))}fps`
        : '';
      groups.push({
        label: `${displayLabel}${fpsDetail} ~${shown} ${densityUnit(cluster[0].kind)} (${cluster.length})`,
        key: `${label}@${density(cluster[0])}`,
        density: d,
        files: cluster,
      });
      cluster = [];
    };
    for (const f of bucket) {
      const representative = cluster.length > 0
        ? density(cluster[Math.floor(cluster.length / 2)])
        : 0;
      if (cluster.length > 0
        && density(f) > representative * (1 + DENSITY_CLUSTER_GAP)) flush();
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
