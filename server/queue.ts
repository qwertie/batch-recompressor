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

/**
 * Sequential encode queue: one ffmpeg process at a time (ffmpeg itself
 * uses many cores). Emits 'update' with a JobState on every change.
 */
export class EncodeQueue extends EventEmitter {
  private jobs = new Map<string, { job: Job; state: JobState }>();
  private pending: string[] = [];
  private current: { path: string; proc: ChildProcess | null } | null = null;
  private cancelRequests = new Map<string, boolean>();

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
    this.emit('update', state);
    this.pump();
  }

  /** Remove from the queue; kills ffmpeg if this job is currently processing. */
  unqueue(filePath: string, deletePartial = true): void {
    const entry = this.jobs.get(filePath);
    if (!entry) return;
    this.pending = this.pending.filter(p => p !== filePath);
    if (this.current?.path === filePath) {
      this.cancelRequests.set(filePath, deletePartial);
      if (this.current.proc) this.current.proc.kill('SIGKILL');
      // pump() continues in run(), including if cancellation arrived before spawn.
    } else if (entry.state.status === 'enqueued') {
      entry.state.status = 'notQueued';
      entry.state.progress = 0;
      this.emit('update', entry.state);
    }
  }

  /** Revert every waiting job to notQueued, without stopping the active job. */
  cancelPending(): void {
    for (const filePath of [...this.pending]) this.unqueue(filePath);
  }

  /** Stop only the active job. */
  stopCurrent(deletePartial = true): boolean {
    if (!this.current) return false;
    this.unqueue(this.current.path, deletePartial);
    return true;
  }

  /** Forget non-processing records. Source and output files are untouched. */
  clear(paths: string[]): void {
    for (const filePath of paths) {
      if (this.current?.path === filePath) continue;
      this.pending = this.pending.filter(p => p !== filePath);
      this.jobs.delete(filePath);
    }
  }

  private pump(): void {
    if (this.current) return;
    const next = this.pending.shift();
    if (next === undefined) return;
    const entry = this.jobs.get(next)!;
    this.current = { path: next, proc: null }; // claim the slot before any awaits
    void this.run(entry.job, entry.state);
  }

  private async run(job: Job, state: JobState): Promise<void> {
    const f = job.info;
    let outputStarted = false;
    state.status = 'processing';
    state.progress = 0;
    this.emit('update', state);
    try {
      const outPath = outputPathFor(
        f.path, f.rootFolder, job.outputFolder, outputExt(f.kind, job.settings));
      state.outputPath = outPath;
      if (!job.overwrite) {
        // Skip work that's already done: existing non-empty output counts as finished.
        const existing = await fs.stat(outPath).catch(() => null);
        if (existing && existing.size > 0) {
          state.status = 'finished';
          state.progress = 1;
          state.outputSize = existing.size;
          this.current = null;
          this.emit('update', state);
          this.pump();
          return;
        }
      }
      if (this.cancelRequests.has(f.path)) throw new Error('cancelled');
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      if (this.cancelRequests.has(f.path)) throw new Error('cancelled');
      const args = ffmpegArgs(f, outPath, job.settings);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        outputStarted = true;
        this.current = { path: f.path, proc };
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
      state.status = 'finished';
      state.progress = 1;
      try { state.outputSize = (await fs.stat(state.outputPath)).size; } catch { /* ignore */ }
    } catch (err: any) {
      if (err.message === 'cancelled') {
        state.status = 'notQueued';
        state.progress = 0;
        if (outputStarted && state.outputPath && this.cancelRequests.get(f.path) !== false)
          await fs.rm(state.outputPath, { force: true }).catch(() => {});
      } else {
        state.status = 'error';
        state.error = String(err.message ?? err);
      }
    }
    this.cancelRequests.delete(f.path);
    this.current = null;
    this.emit('update', state);
    this.pump();
  }
}
