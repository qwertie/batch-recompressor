import { describe, it, expect } from 'vitest';
import { ViewModel } from '../src/viewmodel.js';
import { file, fakeFetch } from './helpers.js';
import { DEFAULT_SETTINGS } from '../shared/types.js';

describe('ViewModel', () => {
  it('addFolder scans and populates files and groups', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4'), file('/in/b.mp4', 8000)]));
    await vm.addFolder('/in');
    expect(vm.rootFolders).toEqual(['/in']);
    expect(vm.files).toHaveLength(2);
    expect(vm.groups).toHaveLength(2); // densities >25% apart
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
    expect(vm.effectiveSettings(f).compressionRatio)
      .toBe(DEFAULT_SETTINGS.compressionRatio);
    const gkey = vm.groups[0].key;
    vm.setOverride('group', gkey, 'compressionRatio', 6);
    vm.setOverride('group', gkey, 'effort', 3);
    expect(vm.effectiveSettings(f).compressionRatio).toBe(6);
    vm.setOverride('file', f.path, 'compressionRatio', 8);
    expect(vm.effectiveSettings(f)).toMatchObject({ compressionRatio: 8, effort: 3 });
    vm.setOverride('file', f.path, 'compressionRatio', undefined);
    expect(vm.effectiveSettings(f).compressionRatio).toBe(6);
  });

  it('can reset global settings and clear selected overrides', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4')]));
    await vm.addFolder('/in');
    vm.setSetting('compressionRatio', 9);
    vm.setSetting('maxWidth', 1280);
    vm.resetSettings();
    expect(vm.settings).toEqual(DEFAULT_SETTINGS);

    const key = vm.groups[0].key;
    vm.setOverride('group', key, 'maxWidth', 640);
    vm.select({ kind: 'group', key });
    vm.clearSelectionSettings();
    expect(vm.groupOverrides.has(key)).toBe(false);
  });

  it('start enqueues the selection with file info and effective settings', async () => {
    const fetcher = fakeFetch([file('/in/a.mp4')]);
    const vm = new ViewModel(fetcher);
    await vm.addFolder('/in');
    vm.setOutputFolder('/out');
    await vm.start();
    expect(vm.statusOf('/in/a.mp4')).toBe('enqueued');
    const call = (fetcher as any).mock.calls.find((c: any[]) => String(c[0]).includes('enqueue'));
    const body = JSON.parse(call[1].body);
    expect(body.outputFolder).toBe('/out');
    expect(body.maxConcurrent).toBe(1);
    expect(body.files[0].info.path).toBe('/in/a.mp4');
    expect(body.files[0].info.kind).toBe('video');
    expect(body.files[0].settings.videoCodec).toBe('av1');
  });

  it('retries errors but does not restart active or finished files', async () => {
    const fetcher = fakeFetch([
      file('/in/error.mp4'), file('/in/finished.mp4'), file('/in/processing.mp4'),
    ]);
    const vm = new ViewModel(fetcher);
    await vm.addFolder('/in');
    vm.setOutputFolder('/out');
    vm.applyJobUpdate({
      path: '/in/error.mp4', status: 'error', progress: 0, error: 'failed',
    });
    vm.applyJobUpdate({ path: '/in/finished.mp4', status: 'finished', progress: 1 });
    vm.applyJobUpdate({ path: '/in/processing.mp4', status: 'processing', progress: 0.5 });

    await vm.start();
    const call = (fetcher as any).mock.calls.find(
      (c: any[]) => String(c[0]).includes('/api/enqueue'));
    const body = JSON.parse(call[1].body);
    expect(body.files.map((entry: any) => entry.info.path)).toEqual(['/in/error.mp4']);
    expect(vm.statusOf('/in/error.mp4')).toBe('enqueued');
  });

  it('start without an output folder sets an error', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4')]));
    await vm.addFolder('/in');
    await vm.start();
    expect(vm.error).toMatch(/output folder/i);
  });

  it('cancelQueue reverts only waiting jobs in the supplied page scope', async () => {
    const fetcher = fakeFetch([]);
    const vm = new ViewModel(fetcher);
    vm.applyJobUpdate({ path: '/in/a.mp4', status: 'processing', progress: 0.5 });
    vm.applyJobUpdate({ path: '/in/b.mp4', status: 'enqueued', progress: 0 });
    vm.applyJobUpdate({ path: '/other/c.mp4', status: 'enqueued', progress: 0 });
    await vm.cancelQueue([file('/in/b.mp4')]);
    expect(vm.statusOf('/in/a.mp4')).toBe('processing');
    expect(vm.statusOf('/in/b.mp4')).toBe('notQueued');
    expect(vm.statusOf('/other/c.mp4')).toBe('enqueued');
    const call = (fetcher as any).mock.calls.find(
      (c: any[]) => String(c[0]).includes('/api/unqueue'));
    expect(JSON.parse(call[1].body).paths).toEqual(['/in/b.mp4']);
  });

  it('stopProcessing stops only processing jobs in the supplied page scope', async () => {
    const fetcher = fakeFetch([]);
    const vm = new ViewModel(fetcher);
    vm.applyJobUpdate({ path: '/in/a.mp4', status: 'processing', progress: 0.5 });
    vm.applyJobUpdate({ path: '/other/b.mp4', status: 'processing', progress: 0.5 });
    await vm.stopProcessing([file('/in/a.mp4')], false);
    const call = (fetcher as any).mock.calls.find(
      (c: any[]) => String(c[0]).includes('/api/unqueue'));
    expect(JSON.parse(call[1].body)).toEqual({
      paths: ['/in/a.mp4'],
      deletePartial: false,
    });
  });

  it('clearAll removes every scanned entry except the one processing', async () => {
    const vm = new ViewModel(fakeFetch([
      file('/in/a.mp4'), file('/in/b.mp4'), file('/in/c.mp4'),
    ]));
    await vm.addFolder('/in');
    vm.applyJobUpdate({ path: '/in/a.mp4', status: 'processing', progress: 0.5 });
    vm.applyJobUpdate({ path: '/in/b.mp4', status: 'enqueued', progress: 0 });
    await vm.clearAll();
    expect(vm.files.map(f => f.path)).toEqual(['/in/a.mp4']);
    expect(vm.statusOf('/in/a.mp4')).toBe('processing');
  });

  it('clearUnqueued removes only notQueued scanned entries', async () => {
    const vm = new ViewModel(fakeFetch([file('/in/a.mp4'), file('/in/b.mp4')]));
    await vm.addFolder('/in');
    vm.applyJobUpdate({ path: '/in/b.mp4', status: 'finished', progress: 1 });
    await vm.clearUnqueued();
    expect(vm.files.map(f => f.path)).toEqual(['/in/b.mp4']);
  });

  it('requests Explorer reveal for a file path', async () => {
    const fetcher = fakeFetch([]);
    const vm = new ViewModel(fetcher);
    await vm.revealInFileManager('C:\\Media\\clip.mp4');
    const call = (fetcher as any).mock.calls.find(
      (c: any[]) => String(c[0]).includes('/api/reveal'));
    expect(JSON.parse(call[1].body)).toEqual({ path: 'C:\\Media\\clip.mp4' });
    await vm.openFile('C:\\Media\\clip.mp4');
    const openCall = (fetcher as any).mock.calls.find(
      (c: any[]) => String(c[0]).includes('/api/open'));
    expect(JSON.parse(openCall[1].body)).toEqual({ path: 'C:\\Media\\clip.mp4' });
  });

  it('reports shell-open failures and clears stale errors on success', async () => {
    let fails = true;
    const fetcher = (async () => ({
      ok: !fails,
      json: async () => fails ? { error: 'File not found' } : { ok: true },
    })) as unknown as typeof fetch;
    const vm = new ViewModel(fetcher);
    await vm.openFile('C:\\Media\\missing.mp4');
    expect(vm.error).toBe('File not found');
    fails = false;
    await vm.openFile('C:\\Media\\present.mp4');
    expect(vm.error).toBe('');
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

  it('scan passes only the enabled extensions', async () => {
    const fetcher = fakeFetch([]);
    const vm = new ViewModel(fetcher);
    vm.setExtEnabled('.mp4', false);
    await vm.addFolder('/in');
    const call = (fetcher as any).mock.calls[0];
    const exts = JSON.parse(call[1].body).extensions;
    expect(exts).not.toContain('.mp4');
    expect(exts).toContain('.mkv');
    expect(exts).toContain('.jpg');
  });
});
