import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MediaFileInfo, MediaKind } from '../shared/types.js';
import { isExcluded } from '../shared/paths.js';
import { ALL_EXTENSIONS } from '../shared/filetypes.js';

const execFileP = promisify(execFile);

/** Recursively list media files under `folder`, filtered by extension. */
export async function findMediaFiles(
  folder: string, outputFolder: string, exclusions: string[],
  extensions: string[] = ALL_EXTENSIONS,
): Promise<string[]> {
  const wanted = new Set(extensions.map(e => e.toLowerCase()));
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
      else if (wanted.has(path.extname(e.name).toLowerCase())
        && !isExcluded(full, outputFolder, exclusions)) results.push(full);
    }
  }
  await walk(folder);
  return results;
}

/**
 * Classify probed streams: a real video stream (not attached cover art) with
 * more than one frame means video; exactly one frame (or no duration) means
 * image; otherwise an audio stream means audio.
 */
export function classify(streams: any[], formatDuration: number): MediaKind | null {
  const v = streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = streams.find(s => s.codec_type === 'audio');
  if (v) {
    const frames = Number(v.nb_frames ?? NaN);
    if (frames === 1 || (!(frames > 1) && !(formatDuration > 0.5))) return 'image';
    return 'video';
  }
  return a ? 'audio' : null;
}

/** Run ffprobe on one file; returns null if it has no usable stream or probing fails. */
export async function probeFile(filePath: string, rootFolder: string): Promise<MediaFileInfo | null> {
  try {
    const { stdout } = await execFileP('ffprobe', [
      '-v', 'error', '-print_format', 'json',
      '-show_format', '-show_streams', filePath,
    ], { maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const streams: any[] = data.streams ?? [];
    const duration = Number(data.format?.duration ?? 0);
    const kind = classify(streams, duration);
    if (!kind) return null;
    const v = streams.find(s => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
    const a = streams.find(s => s.codec_type === 'audio');
    const size = Number(data.format?.size ?? 0);
    const bitRate = Number(data.format?.bit_rate ?? 0)
      || (duration > 0 ? (size * 8) / duration : 0);
    let fps = 0;
    if (kind === 'video' && v) {
      const [num, den] = String(v.avg_frame_rate ?? v.r_frame_rate ?? '30/1').split('/').map(Number);
      fps = den ? num / den : num || 30;
    }
    return {
      path: filePath,
      rootFolder,
      kind,
      width: v?.width ?? 0,
      height: v?.height ?? 0,
      fps: Math.round(fps * 1000) / 1000,
      sampleRate: kind === 'audio' ? Number(a?.sample_rate ?? 0) : 0,
      channels: kind === 'audio' ? Number(a?.channels ?? 0) : 0,
      kbps: kind === 'image' ? 0 : Math.round(bitRate / 1000),
      size,
      duration: kind === 'image' ? 0 : duration,
      codec: (kind === 'audio' ? a?.codec_name : v?.codec_name) ?? 'unknown',
    };
  } catch {
    return null;
  }
}

/** Scan a folder: find media files and probe them (a few in parallel). */
export async function scanFolder(
  folder: string, outputFolder: string, exclusions: string[],
  extensions: string[] = ALL_EXTENSIONS,
): Promise<MediaFileInfo[]> {
  const files = await findMediaFiles(folder, outputFolder, exclusions, extensions);
  const results: MediaFileInfo[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const infos = await Promise.all(
      files.slice(i, i + CONCURRENCY).map(f => probeFile(f, folder)));
    for (const info of infos) if (info) results.push(info);
  }
  return results;
}
