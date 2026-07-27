import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { EncodeSettings, JobState, MediaFileInfo } from '../shared/types.js';
import { outputPathFor } from '../shared/paths.js';
import { ffmpegArgs, outputExt } from '../shared/encode.js';

export interface Job {
  info: MediaFileInfo;
  outputFolder: string;
  settings: EncodeSettings;
  overwrite?: boolean;
}

type SpawnProcess = (
  command: string,
  args: string[],
  options: { stdio: ['ignore', 'pipe', 'pipe'] },
) => ChildProcess;

/**
 * Concurrent encode queue, limited by maxConcurrent. Emits 'update' with a
 * JobState on every change.
 */
export class EncodeQueue extends EventEmitter {
  private jobs = new Map<string, { job: Job; state: JobState }>();
  private pending: string[] = [];
  private current = new Map<string, ChildProcess | null>();
  private cancelRequests = new Map<string, boolean>();
  private maxConcurrent = 1;

  constructor(private spawnProcess: SpawnProcess = spawn) {
    super();
  }

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.min(8, Math.max(1, Math.round(value) || 1));
    this.pump();
  }

  getStates(): JobState[] {
    return [...this.jobs.values()].map(j => j.state);
  }

  enqueue(job: Job): void {
    const key = job.info.path;
    const existing = this.jobs.get(key);
    if (existing && (existing.state.status === 'enqueued' || existing.state.status === 'processing'))
      return;
    const state: JobState = { path: key, status: 'enqueued', progress: 0 };
    this.jobs.set(key, { job, state });
    this.pending.push(key);
    this.pump();
  }

  /** Remove from the queue; kills ffmpeg if this job is currently processing. */
  unqueue(filePath: string, deletePartial = true): void {
    const entry = this.jobs.get(filePath);
    if (!entry) return;
    this.pending = this.pending.filter(p => p !== filePath);
    if (this.current.has(filePath)) {
      this.cancelRequests.set(filePath, deletePartial);
      this.current.get(filePath)?.kill('SIGKILL');
      // pump() continues in run(), including if cancellation arrived before spawn.
    } else if (entry.state.status === 'enqueued') {
      entry.state.status = 'notQueued';
      entry.state.progress = 0;
      this.emit('update', entry.state);
    }
  }

  /** Forget non-processing records. Source and output files are untouched. */
  clear(paths: string[]): void {
    for (const filePath of paths) {
      if (this.current.has(filePath)) continue;
      this.pending = this.pending.filter(p => p !== filePath);
      this.jobs.delete(filePath);
    }
  }

  private pump(): void {
    while (this.current.size < this.maxConcurrent) {
      const next = this.pending.shift();
      if (next === undefined) return;
      const entry = this.jobs.get(next)!;
      this.current.set(next, null); // claim the slot before any awaits
      void this.run(entry.job, entry.state);
    }
  }

  private async run(job: Job, state: JobState): Promise<void> {
    const f = job.info;
    let outputStarted = false;
    let incompletePath: string | undefined;
    state.status = 'processing';
    state.progress = 0;
    this.emit('update', state);
    try {
      const outPath = outputPathFor(
        f.path, f.rootFolder, job.outputFolder, outputExt(f.kind, job.settings));
      if (!job.overwrite) {
        // Skip work that's already done: existing non-empty output counts as finished.
        const existing = await fs.stat(outPath).catch(() => null);
        if (existing && existing.size > 0) {
          state.outputPath = outPath;
          state.status = 'finished';
          state.progress = 1;
          state.outputSize = existing.size;
          this.current.delete(f.path);
          this.emit('update', state);
          this.pump();
          return;
        }
      }
      if (this.cancelRequests.has(f.path)) throw new Error('cancelled');
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      if (this.cancelRequests.has(f.path)) throw new Error('cancelled');
      incompletePath = path.join(path.dirname(outPath), `incomplete.${path.basename(outPath)}`);
      state.outputPath = incompletePath;
      const args = ffmpegArgs(f, incompletePath, job.settings);
      await new Promise<void>((resolve, reject) => {
        const proc = this.spawnProcess('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        outputStarted = true;
        this.current.set(f.path, proc);
        let stderrTail = '';
        proc.stderr!.on('data', (d: Buffer) => {
          stderrTail = (stderrTail + d.toString()).slice(-2000);
        });
        proc.stdout!.on('data', (d: Buffer) => {
          // -progress pipe:1 emits key=value lines including out_time_us
          const m = /out_time_us=(\d+)/.exec(d.toString());
          if (m && f.duration > 0) {
            state.progress = Math.min(1, Number(m[1]) / 1e6 / f.duration);
            this.emit('update', state);
          }
        });
        proc.on('error', reject);
        proc.on('close', (code, signal) => {
          if (signal) reject(new Error('cancelled'));
          else if (code === 0) resolve();
          else reject(new Error(`ffmpeg exited with code ${code}: ${stderrTail.split('\n').slice(-4).join(' ')}`));
        });
      });
      if (job.overwrite) await fs.rm(outPath, { force: true });
      await fs.rename(incompletePath, outPath);
      state.outputPath = outPath;
      state.status = 'finished';
      state.progress = 1;
      try { state.outputSize = (await fs.stat(outPath)).size; } catch { /* ignore */ }
    } catch (err: any) {
      if (err.message === 'cancelled') {
        state.status = 'notQueued';
        state.progress = 0;
        if (outputStarted && incompletePath && this.cancelRequests.get(f.path) !== false)
          await fs.rm(incompletePath, { force: true }).catch(() => {});
      } else {
        state.status = 'error';
        state.error = String(err.message ?? err);
      }
    }
    this.cancelRequests.delete(f.path);
    this.current.delete(f.path);
    this.emit('update', state);
    this.pump();
  }
}
