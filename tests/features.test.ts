// Tests for persistence, group exclusion, rescan, overwrite flag.
import { describe, it, expect, vi } from 'vitest';
import { ViewModel } from '../src/viewmodel.js';
import { file, fakeFetch } from './helpers.js';

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('persistence', () => {
  it('round-trips settings, grouping, extensions, exclusions and overrides', async () => {
    const storage = memoryStorage();
    const vm1 = new ViewModel(fakeFetch([file('/in/a.mp4')]));
    vm1.enablePersistence(storage);
    await vm1.addFolder('/in');
    vm1.setOutputFolder('/out');
    vm1.setOverwrite(true);
    vm1.setSetting('compressionRatio', 5);
    vm1.setSetting('rateMode', 'quality');
    vm1.setGrouping('byFps', false);
    vm1.setExtEnabled('.gif', false);
    vm1.exclude('/in/x.mp4');
    vm1.setOverride('file', '/in/a.mp4', 'effort', 9);

    const vm2 = new ViewModel(fakeFetch([file('/in/a.mp4')]));
    vm2.enablePersistence(storage);
    expect(vm2.outputFolder).toBe('/out');
    expect(vm2.overwrite).toBe(true);
    expect(vm2.settings.compressionRatio).toBe(5);
    expect(vm2.settings.rateMode).toBe('quality');
    expect(vm2.grouping.byFps).toBe(false);
    expect(vm2.enabledExts).not.toContain('.gif');
    expect(vm2.exclusions).toEqual(['/in/x.mp4']);
    expect(vm2.fileOverrides.get('/in/a.mp4')).toEqual({ effort: 9 });
    expect(vm2.rootFolders).toEqual(['/in']);
    await vi.waitFor(() => expect(vm2.files).toHaveLength(1)); // auto-rescan
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
