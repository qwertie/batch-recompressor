import { describe, expect, it, vi } from 'vitest';
import { AppStateStore, StateConflict } from '../server/state.js';
import type { JobState } from '../shared/types.js';
import { file } from './helpers.js';

function fakeQueue() {
  let jobs: JobState[] = [];
  return {
    getStates: () => jobs,
    setMaxConcurrent: vi.fn(),
    unqueue: vi.fn((path: string) => {
      const job = jobs.find(candidate => candidate.path === path);
      if (job?.status === 'enqueued') job.status = 'notQueued';
    }),
    clear: vi.fn((paths: string[]) => {
      const removed = new Set(paths);
      jobs = jobs.filter(job => !removed.has(job.path));
    }),
    setJobs(value: JobState[]) { jobs = value; },
  };
}

describe('AppStateStore', () => {
  it('owns the scanned tree so hydration does not scan again', async () => {
    const queue = fakeQueue();
    const scan = vi.fn(async (folder: string) => [
      file(`${folder}/a.mp4`, 2000, { rootFolder: folder }),
    ]);
    const store = new AppStateStore(queue, scan, () => true);

    await store.dispatch({ type: 'addFolder', folder: '/media' }, 0);
    const refreshedPage = store.snapshot();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(refreshedPage.revision).toBe(1);
    expect(refreshedPage.state.rootFolders).toEqual(['/media']);
    expect(refreshedPage.state.files.map(f => f.path)).toEqual(['/media/a.mp4']);
  });

  it('rejects stale revisions and edits to missing objects', async () => {
    const store = new AppStateStore(fakeQueue(), async () => [], () => true);
    await store.dispatch({ type: 'update', values: { outputFolder: '/out' } }, 0);

    await expect(store.dispatch(
      { type: 'update', values: { overwrite: true } }, 0,
    )).rejects.toBeInstanceOf(StateConflict);
    await expect(store.dispatch({
      type: 'setOverride',
      scope: 'file',
      key: '/missing.mp4',
      value: { effort: 2 },
    }, 1)).rejects.toThrow(/no longer exists/i);
  });

  it('derives enqueue metadata and effective settings from authoritative state', async () => {
    const store = new AppStateStore(
      fakeQueue(),
      async folder => [file(`${folder}/a.mp4`, 2000, { rootFolder: folder })],
      () => true,
    );
    let snapshot = await store.dispatch({ type: 'addFolder', folder: '/media' }, 0);
    snapshot = await store.dispatch({
      type: 'update',
      values: { outputFolder: '/out', overwrite: true },
    }, snapshot.revision);
    snapshot = await store.dispatch({
      type: 'setOverride',
      scope: 'file',
      key: '/media/a.mp4',
      value: { effort: 2 },
    }, snapshot.revision);

    const request = store.enqueueRequest(['/media/a.mp4']);

    expect(request.outputFolder).toBe('/out');
    expect(request.overwrite).toBe(true);
    expect(request.files[0].info.path).toBe('/media/a.mp4');
    expect(request.files[0].settings.effort).toBe(2);
  });

  it('clearAll forgets the complete folder state on the server', async () => {
    const queue = fakeQueue();
    const scan = async (folder: string) => [
      file(`${folder}/a.mp4`, 2000, { rootFolder: folder }),
      file(`${folder}/b.mp4`, 2000, { rootFolder: folder }),
    ];
    const store = new AppStateStore(queue, scan, () => true);
    let snapshot = await store.dispatch({ type: 'addFolder', folder: '/media' }, 0);
    snapshot = await store.dispatch({
      type: 'setOverride',
      scope: 'file',
      key: '/media/a.mp4',
      value: { effort: 2 },
    }, snapshot.revision);
    snapshot = await store.dispatch({
      type: 'exclude',
      paths: ['/media/b.mp4'],
    }, snapshot.revision);

    snapshot = await store.dispatch({ type: 'clearAll' }, snapshot.revision);

    expect(snapshot.state.rootFolders).toEqual([]);
    expect(snapshot.state.files).toEqual([]);
    expect(snapshot.state.exclusions).toEqual([]);
    expect(snapshot.state.fileOverrides).toEqual([]);
  });
});
