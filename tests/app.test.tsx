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
    expect(screen.getByText(/Compression ratio/)).toBeTruthy();
    expect(screen.getByText('Prefer target rate')).toBeTruthy();
    expect(screen.getByText('Prefer quality setting')).toBeTruthy();
    expect(screen.getByText('Group by resolution')).toBeTruthy();
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
      expect(screen.getByText('1920x1080x30 ~0.96 b/px·s')).toBeTruthy());
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
});
