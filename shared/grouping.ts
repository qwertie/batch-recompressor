import type { VideoFileInfo } from './types.js';

export interface FileGroup {
  /** e.g. "1920x1080x30 ~2204 kbps" */
  label: string;
  key: string;
  width: number;
  height: number;
  fps: number;
  /** Representative (median) bitrate of the group, kbps. */
  kbps: number;
  files: VideoFileInfo[];
}

/** Round fps for grouping purposes (29.97 -> 30, 23.976 -> 24). */
export function roundFps(fps: number): number {
  return Math.round(fps);
}

/**
 * Group files by resolution + rounded fps, then split each of those buckets
 * into bitrate clusters such that no two files in one cluster have bitrates
 * more than 30% apart (max <= min * 1.3), using greedy clustering over
 * bitrate-sorted files.
 */
export function groupFiles(files: VideoFileInfo[]): FileGroup[] {
  const buckets = new Map<string, VideoFileInfo[]>();
  for (const f of files) {
    const key = `${f.width}x${f.height}x${roundFps(f.fps)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(f);
  }

  const groups: FileGroup[] = [];
  for (const [resKey, bucket] of buckets) {
    bucket.sort((a, b) => a.kbps - b.kbps);
    let cluster: VideoFileInfo[] = [];
    const flush = () => {
      if (cluster.length === 0) return;
      const kbps = Math.round(cluster[Math.floor(cluster.length / 2)].kbps);
      const { width, height, fps } = cluster[0];
      groups.push({
        label: `${resKey} ~${kbps} kbps`,
        key: `${resKey}@${kbps}`,
        width, height, fps: roundFps(fps), kbps,
        files: cluster,
      });
      cluster = [];
    };
    for (const f of bucket) {
      if (cluster.length > 0 && f.kbps > cluster[0].kbps * 1.3) flush();
      cluster.push(f);
    }
    flush();
  }

  groups.sort((a, b) => b.width * b.height - a.width * a.height || b.kbps - a.kbps);
  return groups;
}
