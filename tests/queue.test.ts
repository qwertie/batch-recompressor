import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
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
  constructor(readonly inputPath: string, readonly outputPath: string) {
    super();
  }
  kill = vi.fn(() => {
    queueMicrotask(() => this.emit('close', null, 'SIGKILL'));
    return true;
  });
  override emit(eventName: string | symbol, ...args: any[]): boolean {
    if (eventName === 'close' && args[0] === 0) writeFileSync(this.outputPath, 'encoded');
    return super.emit(eventName, ...args);
  }
}

const temporaryFolders: string[] = [];

afterEach(async () => {
  for (const folder of temporaryFolders.splice(0))
    await rm(folder, { recursive: true, force: true });
});

describe('EncodeQueue concurrency', () => {
  it('runs up to the configured number of FFmpeg processes', async () => {
    const children: FakeProcess[] = [];
    const spawnProcess = vi.fn((_command: string, args: string[]) => {
      const child = new FakeProcess(args[args.indexOf('-i') + 1], args.at(-1)!);
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
    expect(children.every(child =>
      path.basename(child.outputPath).startsWith('incomplete.')
      && path.extname(child.outputPath) === '.mkv')).toBe(true);

    children[0].emit('close', 0, null);
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledTimes(3));
    expect(queue.getStates().filter(state => state.status === 'processing')).toHaveLength(2);

    children[1].emit('close', 0, null);
    children[2].emit('close', 0, null);
    await vi.waitFor(() =>
      expect(queue.getStates().every(state => state.status === 'finished')).toBe(true));
    expect(children.every(child => !existsSync(child.outputPath))).toBe(true);
    expect(queue.getStates().every(state =>
      state.outputPath && existsSync(state.outputPath))).toBe(true);
  });

  it('stops only the selected active process', async () => {
    const children: FakeProcess[] = [];
    const spawnProcess = vi.fn((_command: string, args: string[]) => {
      const child = new FakeProcess(args[args.indexOf('-i') + 1], args.at(-1)!);
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
    const aChild = children.find(child => child.inputPath === '/in/a.mp4')!;
    const bChild = children.find(child => child.inputPath === '/in/b.mp4')!;
    expect(aChild.kill).toHaveBeenCalledTimes(1);
    expect(bChild.kill).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(queue.getStates().find(state => state.path === '/in/a.mp4')?.status)
        .toBe('notQueued');
    });
    expect(queue.getStates().find(state => state.path === '/in/b.mp4')?.status)
      .toBe('processing');
    bChild.emit('close', 0, null);
  });

  it('leaves an incomplete-prefixed file when FFmpeg fails', async () => {
    let child!: FakeProcess;
    const spawnProcess = vi.fn((_command: string, args: string[]) => {
      child = new FakeProcess(args[args.indexOf('-i') + 1], args.at(-1)!);
      return child as unknown as ChildProcess;
    });
    const outputFolder = await mkdtemp(path.join(tmpdir(), 'batch-recompressor-'));
    temporaryFolders.push(outputFolder);
    const queue = new EncodeQueue(spawnProcess);
    queue.enqueue({
      info: file('/in/a.mp4'),
      outputFolder,
      settings: { ...DEFAULT_SETTINGS },
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    writeFileSync(child.outputPath, 'partial');
    child.emit('close', 1, null);

    await vi.waitFor(() => expect(queue.getStates()[0].status).toBe('error'));
    expect(path.basename(child.outputPath)).toBe('incomplete.a.mkv');
    expect(existsSync(child.outputPath)).toBe(true);
  });

  it('removes the incomplete-prefixed file when an active job is stopped', async () => {
    let child!: FakeProcess;
    const spawnProcess = vi.fn((_command: string, args: string[]) => {
      child = new FakeProcess(args[args.indexOf('-i') + 1], args.at(-1)!);
      return child as unknown as ChildProcess;
    });
    const outputFolder = await mkdtemp(path.join(tmpdir(), 'batch-recompressor-'));
    temporaryFolders.push(outputFolder);
    const queue = new EncodeQueue(spawnProcess);
    queue.enqueue({
      info: file('/in/a.mp4'),
      outputFolder,
      settings: { ...DEFAULT_SETTINGS },
    });

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce());
    writeFileSync(child.outputPath, 'partial');
    queue.unqueue('/in/a.mp4');

    await vi.waitFor(() => expect(queue.getStates()[0].status).toBe('notQueued'));
    expect(existsSync(child.outputPath)).toBe(false);
  });
});
