import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncodeQueue } from '../server/queue.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';
import { file } from './helpers.js';

class FakeProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
    return true;
  });
}

const temporaryFolders: string[] = [];

afterEach(async () => {
  for (const folder of temporaryFolders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

describe('EncodeQueue concurrency', () => {
  it('runs up to the configured number of FFmpeg processes', async () => {
    const children: FakeProcess[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new FakeProcess();
      children.push(child);
      return child as unknown as ChildProcess;
    });
    const outputFolder = await mkdtemp(path.join(tmpdir(), 'batch-recompressor-'));
    temporaryFolders.push(outputFolder);
    const queue = new EncodeQueue(spawnProcess);
    queue.setMaxConcurrent(2);

    for (const name of ['a.mp4', 'b.mp4', 'c.mp4']) {
      queue.enqueue({
        info: file(`/in/${name}`),
        outputFolder,
        settings: { ...DEFAULT_SETTINGS },
      });
    }

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));
    expect(queue.getStates().filter(state => state.status === 'processing')).toHaveLength(2);

    children[0].emit('close', 0, null);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(3));
    expect(queue.getStates().filter(state => state.status === 'processing')).toHaveLength(2);

    children[1].emit('close', 0, null);
    children[2].emit('close', 0, null);
    await vi.waitFor(() =>
      expect(queue.getStates().every(state => state.status === 'finished')).toBe(true));
  });

  it('stops only the selected active process', async () => {
    const children: FakeProcess[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new FakeProcess();
      children.push(child);
      return child as unknown as ChildProcess;
    });
    const outputFolder = await mkdtemp(path.join(tmpdir(), 'batch-recompressor-'));
    temporaryFolders.push(outputFolder);
    const queue = new EncodeQueue(spawnProcess);
    queue.setMaxConcurrent(2);
    for (const name of ['a.mp4', 'b.mp4']) {
      queue.enqueue({
        info: file(`/in/${name}`),
        outputFolder,
        settings: { ...DEFAULT_SETTINGS },
      });
    }
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(2));

    queue.unqueue('/in/a.mp4');
    expect(children[0].kill).toHaveBeenCalledTimes(1);
    expect(children[1].kill).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(queue.getStates().find(state => state.path === '/in/a.mp4')?.status)
        .toBe('notQueued');
    });
    expect(queue.getStates().find(state => state.path === '/in/b.mp4')?.status)
      .toBe('processing');
    children[1].emit('close', 0, null);
  });
});
