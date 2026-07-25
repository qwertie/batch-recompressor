// Basic UI smoke tests (no end-to-end): render the app with a fake fetch,
// add a folder, and check that the tree and detail page respond.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';
import { ViewModel } from '../src/viewmodel.js';
import type { VideoFileInfo } from '../shared/types.js';

function file(path: string, kbps = 2000): VideoFileInfo {
  return {
    path, rootFolder: '/in', width: 1920, height: 1080, fps: 30,
    kbps, size: 1e8, duration: 60, codec: 'h264',
  };
}

function makeVM(scanResult: VideoFileInfo[]) {
  const fetcher = vi.fn(async (url: RequestInfo | URL) => ({
    ok: true,
    json: async () => (String(url).includes('/api/scan') ? scanResult : { ok: true }),
  })) as unknown as typeof fetch;
  return new ViewModel(fetcher);
}

describe('App', () => {
  it('renders the root page with global settings and Add folder button', () => {
    render(<App vm={makeVM([])} />);
    expect(screen.getByText('Add folder')).toBeTruthy();
    expect(screen.getAllByText('All files').length).toBeGreaterThan(0); // tree node + page title
    expect(screen.getByText(/Compression ratio/)).toBeTruthy();
  });

  it('adds a folder and shows a bitrate group in the tree', async () => {
    const vm = makeVM([file('/in/sub/a.mp4', 2204)]);
    render(<App vm={vm} />);
    fireEvent.change(screen.getByPlaceholderText('Folder to add…'), {
      target: { value: '/in' },
    });
    fireEvent.click(screen.getByText('Add folder'));
    await waitFor(() =>
      expect(screen.getByText('1920x1080x30 ~2204 kbps')).toBeTruthy());
    // File row appears in the root page's flat list too
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
});
