import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { VideoFileInfo } from '../shared/types.js';
import { isExcluded } from '../shared/paths.js';

const execFileP = promisify(execFile);

export const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.webm', '.m4v', '.mpg', '.mpeg',
  '.ts', '.m2ts', '.flv', '.3gp', '.ogv',
]);

/** Recursively list video files under `folder`, skipping excluded paths. */
export async function findVideoFiles(
  folder: string, outputFolder: string, exclusions: string[],
): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (isExcluded(dir, outputFolder, exclusions)) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // unreadable folder: skip
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (VIDEO_EXTENSIONS.has(path.extname(e.name).toLowerCase())
        && !isExcluded(full, outputFolder, exclusions)) results.push(full);
    }
  }
  await walk(folder);
  return results;
}

/** Run ffprobe on one file; returns null if it has no video stream or probing fails. */
export async function probeFile(filePath: string, rootFolder: string): Promise<VideoFileInfo | null> {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ], { maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const v = (data.streams ?? []).find((s: any) => s.codec_type === 'video');
    if (!v || !v.width) return null;
    const [num, den] = String(v.avg_frame_rate ?? v.r_frame_rate ?? '30/1').split('/').map(Number);
    const fps = den ? num / den : num || 30;
    const duration = Number(data.format?.duration ?? v.duration ?? 0);
    const size = Number(data.format?.size ?? 0);
    const bitRate = Number(data.format?.bit_rate ?? 0)
      || (duration > 0 ? (size * 8) / duration : 0);
    return {
      path: filePath,
      rootFolder,
      width: v.width,
      height: v.height,
      fps: Math.round(fps * 1000) / 1000,
      kbps: Math.round(bitRate / 1000),
      size,
      duration,
      codec: v.codec_name ?? 'unknown',
    };
  } catch {
    return null;
  }
}

/** Scan a folder: find video files and probe them (a few in parallel). */
export async function scanFolder(
  folder: string, outputFolder: string, exclusions: string[],
): Promise<VideoFileInfo[]> {
  const files = await findVideoFiles(folder, outputFolder, exclusions);
  const results: VideoFileInfo[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const infos = await Promise.all(
      files.slice(i, i + CONCURRENCY).map(f => probeFile(f, folder)));
    for (const info of infos) if (info) results.push(info);
  }
  return results;
}
