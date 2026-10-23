// Electron-only folder pickers, driven through a fake DesktopHost.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from '../src/App.js';
import { ViewModel } from '../src/viewmodel.js';
import { file, fakeFetch } from './helpers.js';
import type { DesktopHost } from '../shared/desktop.js';

function makeVM(desktop?: DesktopHost) {
  return new ViewModel(fakeFetch([file('/in/a.mp4')]), () => false, desktop);
}

describe('Desktop folder pickers', () => {
  it('are hidden in the browser', () => {
    const vm = makeVM();
    render(<App vm={vm} />);
    expect(vm.canPickFolders).toBe(false);
    expect(screen.queryByText('Browse…')).toBeNull();
  });

  it('add the chosen folder and set the output folder', async () => {
    const pickFolder = vi.fn<DesktopHost['pickFolder']>()
      .mockResolvedValueOnce('/in').mockResolvedValueOnce('/out');
    const vm = makeVM({ pickFolder });
    render(<App vm={vm} />);
    const [outputBrowse, addBrowse] = screen.getAllByText('Browse…');

    fireEvent.click(addBrowse);
    await waitFor(() => expect(vm.files.map(f => f.path)).toEqual(['/in/a.mp4']));
    fireEvent.click(outputBrowse);
    await waitFor(() => expect(vm.outputFolder).toBe('/out'));
    expect(pickFolder).toHaveBeenLastCalledWith('');
  });

  it('change nothing when the dialog is cancelled', async () => {
    const vm = makeVM({ pickFolder: async () => undefined });
    vm.setOutputFolder('/old');
    await vm.pickAndAddFolder();
    await vm.pickOutputFolder();
    expect(vm.rootFolders).toEqual([]);
    expect(vm.outputFolder).toBe('/old');
  });
});
