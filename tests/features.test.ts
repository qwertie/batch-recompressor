// Tests for server hydration, group exclusion, rescan, overwrite flag.
import { describe, it, expect, vi } from 'vitest';
import { ViewModel } from '../src/viewmodel.js';
import { file, fakeFetch } from './helpers.js';
import { initialAppState } from '../shared/state.js';

describe('server state hydration', () => {
  it('restores the complete tree with one state fetch and no scan', async () => {
    const state = initialAppState();
    state.rootFolders = ['/in'];
    state.files = [file('/in/a.mp4')];
    state.outputFolder = '/out';
    state.overwrite = true;
    state.showDirectoryTree = false;
    state.maxConcurrent = 4;
    state.settings.compressionRatio = 5;
    state.grouping.byFps = false;
    state.enabledExts = state.enabledExts.filter(ext => ext !== '.gif');
    state.exclusions = ['/in/x.mp4'];
    state.fileOverrides = [['/in/a.mp4', { effort: 9 }]];
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ revision: 7, state, jobs: [] }),
    })) as unknown as typeof fetch;
    const vm = new ViewModel(fetcher);

    await vm.loadState();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('/api/state');
    expect(vm.files.map(f => f.path)).toEqual(['/in/a.mp4']);
    expect(vm.outputFolder).toBe('/out');
    expect(vm.overwrite).toBe(true);
    expect(vm.showDirectoryTree).toBe(false);
    expect(vm.maxConcurrent).toBe(4);
    expect(vm.settings.compressionRatio).toBe(5);
    expect(vm.grouping.byFps).toBe(false);
    expect(vm.enabledExts).not.toContain('.gif');
    expect(vm.exclusions).toEqual(['/in/x.mp4']);
    expect(vm.fileOverrides.get('/in/a.mp4')).toEqual({ effort: 9 });
  });

  it('asks to reload and replaces the mirror when the server rejects a stale edit', async () => {
    const initial = initialAppState();
    initial.outputFolder = '/initial';
    const authoritative = initialAppState();
    authoritative.outputFolder = '/server';
    let gets = 0;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) {
        gets++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            revision: gets === 1 ? 2 : 3,
            state: gets === 1 ? initial : authoritative,
            jobs: [],
          }),
        };
      }
      return {
        ok: false,
        status: 409,
        json: async () => ({ error: 'The folder being edited no longer exists.' }),
      };
    }) as unknown as typeof fetch;
    const confirmReload = vi.fn(() => true);
    const vm = new ViewModel(fetcher, confirmReload);
    await vm.loadState();

    vm.setOutputFolder('/local');

    await vi.waitFor(() => expect(vm.outputFolder).toBe('/server'));
    expect(confirmReload).toHaveBeenCalledWith(expect.stringMatching(/reload state/i));
    expect(gets).toBe(2);
  });

  it('starts server-owned files by identity rather than trusting client metadata', async () => {
    const state = initialAppState();
    state.rootFolders = ['/in'];
    state.files = [file('/in/a.mp4')];
    state.outputFolder = '/out';
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ revision: 1, state, jobs: [] }),
    })) as unknown as typeof fetch;
    const vm = new ViewModel(fetcher);
    await vm.loadState();

    await vm.start();

    const enqueue = (fetcher as any).mock.calls.find(
      (call: any[]) => String(call[0]).includes('/api/enqueue'))!;
    expect(JSON.parse((enqueue[1] as RequestInit).body as string))
      .toEqual({ paths: ['/in/a.mp4'] });
  });

  it('waits for preceding setting edits before starting an encode', async () => {
    const state = initialAppState();
    state.rootFolders = ['/in'];
    state.files = [file('/in/a.mp4')];
    state.outputFolder = '/out';
    let releaseSave!: () => void;
    const saveReleased = new Promise<void>(resolve => { releaseSave = resolve; });
    const calls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method) return {
        ok: true, status: 200,
        json: async () => ({ revision: 1, state, jobs: [] }),
      };
      if (String(url) === '/api/state') {
        calls.push('save');
        await saveReleased;
        return { ok: true, status: 200, json: async () => ({ revision: 2 }) };
      }
      calls.push('enqueue');
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }) as unknown as typeof fetch;
    const vm = new ViewModel(fetcher);
    await vm.loadState();

    vm.setSetting('effort', 2);
    const starting = vm.start();
    await vi.waitFor(() => expect(calls).toEqual(['save']));
    releaseSave();
    await starting;

    expect(calls).toEqual(['save', 'enqueue']);
  });
});

describe('excludeGroup', () => {
  it('excludes every file in the group', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4'), file('/in/b.mp4'), file('/in/c.mp4', 9000)]));
    await vm.addFolder('/in');
    const smallGroup = vm.groups.find(g => g.files.length === 2)!;
    vm.excludeGroup(smallGroup.key);
    expect(vm.exclusions.sort()).toEqual(['/in/a.mp4', '/in/b.mp4']);
    expect(vm.visibleFiles.map(f => f.path)).toEqual(['/in/c.mp4']);
  });
});

describe('rescanAll', () => {
  it('replaces files of each root folder', async () => {
    let result = [file('/in/a.mp4')];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => ({
      ok: true,
      json: async () => (String(url).includes('/api/scan') ? result : { ok: true }),
    })) as unknown as typeof fetch;
    const vm = new ViewModel(fetcher);
    await vm.addFolder('/in');
    expect(vm.files.map(f => f.path)).toEqual(['/in/a.mp4']);
    result = [file('/in/b.mp4')]; // a.mp4 deleted, b.mp4 appeared
    await vm.rescanAll();
    expect(vm.files.map(f => f.path)).toEqual(['/in/b.mp4']);
  });
});

describe('start payload', () => {
  it('includes the overwrite flag', async () => {
    const fetcher = fakeFetch([file('/in/a.mp4')]);
    const vm = new ViewModel(fetcher);
    await vm.addFolder('/in');
    vm.setOutputFolder('/out');
    vm.setOverwrite(true);
    await vm.start();
    const call = (fetcher as any).mock.calls.find((c: any[]) => String(c[0]).includes('enqueue'));
    expect(JSON.parse(call[1].body).overwrite).toBe(true);
  });
});
