// Basic UI smoke tests (no end-to-end): render the app with a fake fetch,
// add a folder, and check that the tree and detail page respond.
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';
import { ViewModel } from '../src/viewmodel.js';
import { file, fakeFetch } from './helpers.js';
import type { MediaFileInfo } from '../shared/types.js';

function makeVM(scanResult: MediaFileInfo[]) {
  return new ViewModel(fakeFetch(scanResult));
}

describe('App', () => {
  it('renders the root page with settings, rate-mode radios and Add folder', () => {
    render(<App vm={makeVM([])} />);
    expect(screen.getByText('Add folder')).toBeTruthy();
    expect(screen.getAllByText('All files').length).toBeGreaterThan(0); // tree node + page title
    expect(screen.getAllByText(/Compression ratio/).length).toBeGreaterThan(0);
    // These also appear inside tooltip bubbles, hence getAllByText
    expect(screen.getAllByText('Prefer target rate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Prefer quality setting').length).toBeGreaterThan(0);
    expect(screen.getByText('Group by resolution')).toBeTruthy();
    expect(screen.getByText('Show directory tree')).toBeTruthy();
    expect(screen.getByLabelText('Files to process at once')).toHaveProperty('value', '1');
    expect(screen.getByText('Reset global settings')).toBeTruthy();
    const numericInputs =
      [...document.querySelectorAll<HTMLInputElement>('input[type="number"]')];
    expect(numericInputs.slice(3, 6).map(input => input.value)).toEqual(['', '', '']);
    expect(screen.getByText(/🖼 Images/)).toBeTruthy(); // file-type tree roots
    expect(screen.getByText(/🔊 Audio/)).toBeTruthy();
  });

  it('adds a folder and shows a density group in the tree', async () => {
    const vm = makeVM([file('/in/sub/a.mp4', 2000)]);
    render(<App vm={vm} />);
    fireEvent.change(screen.getByPlaceholderText('Folder to add…'), {
      target: { value: '/in' },
    });
    fireEvent.click(screen.getByText('Add folder'));
    await waitFor(() =>
      expect(screen.getByText('1920x1080 ~30fps ~0.96 b/s/px (1)')).toBeTruthy());
    expect(screen.getAllByText('/in/sub/a.mp4').length).toBeGreaterThan(0);
  });

  it('shows compact root-relative paths directly below groups in flat mode', async () => {
    const vm = makeVM([file('C:\\A\\LongFolderName\\C\\D.mp4', 2000, {
      rootFolder: 'C:\\A\\LongFolderName',
    })]);
    render(<App vm={vm} />);
    await vm.addFolder('C:\\A\\LongFolderName');
    fireEvent.click(screen.getByLabelText('Show directory tree'));
    await waitFor(() =>
      expect(screen.getByText(/LongFolderN\.\.\.\\C\\D\.mp4/)).toBeTruthy());
    expect(screen.queryByText(/📂 C:\\A\\LongFolderName/)).toBeNull();
  });

  it('Exclude button hides the file and lists it under Exclusions', async () => {
    const vm = makeVM([file('/in/a.mp4')]);
    render(<App vm={vm} />);
    await vm.addFolder('/in');
    const excludeBtn = await screen.findByText('Exclude');
    fireEvent.click(excludeBtn);
    await waitFor(() => expect(screen.getByText('Exclusions')).toBeTruthy());
    expect(vm.visibleFiles).toHaveLength(0);
    fireEvent.click(screen.getAllByText('Remove')[0]); // first Remove = exclusion entry
    await waitFor(() => expect(vm.visibleFiles).toHaveLength(1));
  });

  it('unchecking "Group by framerate" merges fps-differing groups', async () => {
    const vm = makeVM([file('/in/a.mp4', 2000, { fps: 30 }), file('/in/b.mp4', 2000, { fps: 60 })]);
    render(<App vm={vm} />);
    await vm.addFolder('/in');
    await waitFor(() => expect(vm.groups).toHaveLength(2));
    fireEvent.click(screen.getByLabelText(/Group by framerate/));
    await waitFor(() => expect(vm.groups).toHaveLength(1));
  });

  it('uses friendly names for inherited codec options', async () => {
    const vm = makeVM([file('/in/a.mp4')]);
    await vm.addFolder('/in');
    vm.select({ kind: 'group', key: vm.groups[0].key });
    render(<App vm={vm} />);
    expect(screen.getByRole('option', { name: 'AV1 (inherited)' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '(inherit: av1)' })).toBeNull();
  });

  it('counts an errored file as retryable in the Start button', async () => {
    const vm = makeVM([file('/in/error.mp4'), file('/in/finished.mp4')]);
    await vm.addFolder('/in');
    vm.applyJobUpdate({
      path: '/in/error.mp4', status: 'error', progress: 0, error: 'failed',
    });
    vm.applyJobUpdate({ path: '/in/finished.mp4', status: 'finished', progress: 1 });
    render(<App vm={vm} />);
    expect(screen.getByRole('button', { name: '▶ Start (1)' })).toBeTruthy();
  });

  it('shows Stop only when the current file page contains a processing file', async () => {
    const vm = makeVM([file('/in/a.mp4'), file('/in/b.mp4')]);
    await vm.addFolder('/in');
    vm.applyJobUpdate({ path: '/in/a.mp4', status: 'processing', progress: 0.5 });
    vm.select({ kind: 'file', path: '/in/b.mp4' });
    const { rerender } = render(<App vm={vm} />);
    expect(screen.queryByRole('button', { name: '■ Stop' })).toBeNull();

    vm.select({ kind: 'file', path: '/in/a.mp4' });
    rerender(<App vm={vm} />);
    expect(screen.getByRole('button', { name: '■ Stop' })).toBeTruthy();
  });

  it('makes the file-page title a Show in file manager link', async () => {
    const fetcher = fakeFetch([file('/in/a.mp4')]);
    const vm = new ViewModel(fetcher);
    await vm.addFolder('/in');
    vm.select({ kind: 'file', path: '/in/a.mp4' });
    render(<App vm={vm} />);
    const link = screen.getByTitle('Show in file manager');
    expect(link.textContent).toBe('/in/a.mp4');
    fireEvent.click(link);
    await waitFor(() => expect((fetcher as any).mock.calls.some(
      (c: any[]) => String(c[0]).includes('/api/reveal'))).toBe(true));
  });

  it('opens queue filenames and reveals completed outputs', async () => {
    const fetcher = fakeFetch([file('/in/a.mp4')]);
    const vm = new ViewModel(fetcher);
    await vm.addFolder('/in');
    vm.applyJobUpdate({
      path: '/in/a.mp4', status: 'finished', progress: 1,
      outputPath: 'C:\\out\\a.mkv', outputSize: 1000,
    });
    render(<App vm={vm} />);

    fireEvent.click(screen.getByTitle('Open file'));
    fireEvent.click(screen.getByTitle('Show output in file manager'));
    await waitFor(() => {
      expect((fetcher as any).mock.calls.some(
        (c: any[]) => String(c[0]).includes('/api/open'))).toBe(true);
      expect((fetcher as any).mock.calls.some(
        (c: any[]) => String(c[0]).includes('/api/reveal'))).toBe(true);
    });
  });
});
