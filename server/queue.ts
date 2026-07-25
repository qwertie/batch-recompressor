import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import type { EncodeSettings, JobState } from '../shared/types.js';
import { outputPathFor } from '../shared/paths.js';
import { ffmpegArgs } from '../shared/encode.js';

export interface Job {
  path: string;
  rootFolder: string;
  outputFolder: string;
  settings: EncodeSettings;
  kbps: number;
  duration?: number;
}

/**
 * Sequential encode queue: one ffmpeg process at a time (ffmpeg itself
 * uses many cores). Emits 'update' with a JobState on every change.
 */
export class EncodeQueue extends EventEmitter {
  private jobs = new Map<string, { job: Job; state: JobState }>();
  private pending: string[] = [];
  private current: { path: string; proc: ChildProcess } | null = null;

  getStates(): JobState[] {
    return [...this.jobs.values()].map(j => j.state);
  }

  enqueue(job: Job): void {
    const existing = this.jobs.get(job.path);
    if (existing && (existing.state.status === 'enqueued' || existing.state.status === 'processing'))
      return;
    const state: JobState = { path: job.path, status: 'enqueued', progress: 0 };
    this.jobs.set(job.path, { job, state });
    this.pending.push(job.path);
    this.emit('update', state);
    this.pump();
  }

  /** Remove from the queue; kills ffmpeg if this job is currently processing. */
  unqueue(filePath: string): void {
    const entry = this.jobs.get(filePath);
    if (!entry) return;
    this.pending = this.pending.filter(p => p !== filePath);
    if (this.current?.path === filePath) {
      this.current.proc.kill('SIGKILL');
      // pump() continues via the process 'close' handler
    } else if (entry.state.status === 'enqueued') {
      entry.state.status = 'notQueued';
      entry.state.progress = 0;
      this.emit('update', entry.state);
    }
  }

  private pump(): void {
    if (this.current) return;
    const next = this.pending.shift();
    if (next === undefined) return;
    const entry = this.jobs.get(next)!;
    void this.run(entry.job, entry.state);
  }

  private async run(job: Job, state: JobState): Promise<void> {
    state.status = 'processing';
    state.progress = 0;
    this.emit('update', state);
    try {
      const outPath = outputPathFor(job.path, job.rootFolder, job.outputFolder);
      state.outputPath = outPath;
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      const args = ffmpegArgs(job.path, outPath, job.kbps, job.settings);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
        this.current = { path: job.path, proc };
        let stderrTail = '';
        proc.stderr!.on('data', (d: Buffer) => {
          stderrTail = (stderrTail + d.toString()).slice(-2000);
        });
        proc.stdout!.on('data', (d: Buffer) => {
          // -progress pipe:1 emits key=value lines including out_time_us
          const m = /out_time_us=(\d+)/.exec(d.toString());
          if (m && job.duration) {
            state.progress = Math.min(1, Number(m[1]) / 1e6 / job.duration);
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
        if (state.outputPath) await fs.rm(state.outputPath, { force: true }).catch(() => {});
      } else {
        state.status = 'error';
        state.error = String(err.message ?? err);
      }
    }
    this.current = null;
    this.emit('update', state);
    this.pump();
  }
}
