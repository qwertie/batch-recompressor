import { describe, it, expect, vi } from 'vitest';
import { ViewModel } from '../src/viewmodel.js';
import type { VideoFileInfo } from '../shared/types.js';

function file(path: string, kbps = 2000): VideoFileInfo {
  return {
    path, rootFolder: '/in', width: 1920, height: 1080, fps: 30,
    kbps, size: 1e8, duration: 60, codec: 'h264',
  };
}

function fakeFetch(scanResult: VideoFileInfo[] = []) {
  return vi.fn(async (url: RequestInfo | URL) => ({
    ok: true,
    json: async () => (String(url).includes('/api/scan') ? scanResult : { ok: true }),
  })) as unknown as typeof fetch;
}

describe('ViewModel', () => {
  it('addFolder scans and populates files and groups', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4'), file('/in/b.mp4', 8000)]));
    await vm.addFolder('/in');
    expect(vm.rootFolders).toEqual(['/in']);
    expect(vm.files).toHaveLength(2);
    expect(vm.groups).toHaveLength(2); // bitrates >30% apart
  });

  it('exclude removes a file from the tree and adds it to the list', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4'), file('/in/b.mp4')]));
    await vm.addFolder('/in');
    vm.exclude('/in/a.mp4');
    expect(vm.exclusions).toEqual(['/in/a.mp4']);
    expect(vm.visibleFiles.map(f => f.path)).toEqual(['/in/b.mp4']);
    vm.removeExclusion('/in/a.mp4');
    expect(vm.visibleFiles).toHaveLength(2);
  });

  it('files inside the output folder are implicitly excluded', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4'), file('/in/out/b.mp4')]));
    await vm.addFolder('/in');
    vm.setOutputFolder('/in/out');
    expect(vm.visibleFiles.map(f => f.path)).toEqual(['/in/a.mp4']);
  });

  it('effectiveSettings layers global < group < file overrides', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4')]));
    await vm.addFolder('/in');
    const f = vm.files[0];
    expect(vm.effectiveSettings(f).compressionRatio).toBe(4);
    const gkey = vm.groups[0].key;
    vm.setOverride('group', gkey, 'compressionRatio', 6);
    vm.setOverride('group', gkey, 'effort', 3);
    expect(vm.effectiveSettings(f).compressionRatio).toBe(6);
    vm.setOverride('file', f.path, 'compressionRatio', 8);
    expect(vm.effectiveSettings(f)).toMatchObject({ compressionRatio: 8, effort: 3 });
    vm.setOverride('file', f.path, 'compressionRatio', undefined);
    expect(vm.effectiveSettings(f).compressionRatio).toBe(6);
  });

  it('start enqueues the selection and marks jobs enqueued', async () => {
    const fetcher = fakeFetch([file('/in/a.mp4')]);
    const vm = new ViewModel(fetcher);
    await vm.addFolder('/in');
    vm.setOutputFolder('/out');
    await vm.start();
    expect(vm.statusOf('/in/a.mp4')).toBe('enqueued');
    const call = (fetcher as any).mock.calls.find((c: any[]) => String(c[0]).includes('enqueue'));
    const body = JSON.parse(call[1].body);
    expect(body.outputFolder).toBe('/out');
    expect(body.files[0].settings.codec).toBe('av1');
  });

  it('start without an output folder sets an error', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4')]));
    await vm.addFolder('/in');
    await vm.start();
    expect(vm.error).toMatch(/output folder/i);
  });

  it('selection drives selectedFiles', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4'), file('/in/b.mp4', 9000)]));
    await vm.addFolder('/in');
    expect(vm.selectedFiles).toHaveLength(2);
    vm.select({ kind: 'group', key: vm.groups[0].key });
    expect(vm.selectedFiles).toHaveLength(1);
    vm.select({ kind: 'file', path: '/in/b.mp4' });
    expect(vm.selectedFiles.map(f => f.path)).toEqual(['/in/b.mp4']);
  });
});
