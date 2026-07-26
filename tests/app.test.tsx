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
      expect(screen.getByText('1920x1080 ~30fps ~0.96 b/px·s (1)')).toBeTruthy());
    expect(screen.getAllByText('/in/sub/a.mp4').length).toBeGreaterThan(0);
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
