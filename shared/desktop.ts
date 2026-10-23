/**
 * Native features that the Electron preload script (electron/preload.ts) offers to the
 * client; absent when the client runs in an ordinary browser.
 */
export interface DesktopHost {
  /** Shows a native folder chooser; resolves to the chosen folder, or undefined if cancelled. */
  pickFolder(defaultPath?: string): Promise<string | undefined>;
}

/** Name of the window property through which the preload script exposes its DesktopHost. */
export const DESKTOP_HOST_GLOBAL = 'batchRecompressorDesktop';
/** IPC channel on which the Electron main process answers DesktopHost.pickFolder. */
export const PICK_FOLDER_CHANNEL = 'pick-folder';
