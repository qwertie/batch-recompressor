// Electron shell around the web app: the main process runs the same Express backend on a
// private loopback port and the window loads the same built client from it, so only folder
// pickers (see preload.ts) are Electron-specific.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import { startServer } from '../server/app.js';
import { PICK_FOLDER_CHANNEL } from '../shared/desktop.js';

app.whenReady().then(async () => {
  const server = await startServer(0, path.join(app.getAppPath(), 'dist'), '127.0.0.1');
  const { port } = server.address() as AddressInfo;
  ipcMain.handle(PICK_FOLDER_CHANNEL, async (event, defaultPath?: string) => {
    const window = BrowserWindow.fromWebContents(event.sender)!;
    const result = await dialog.showOpenDialog(window, {
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? undefined : result.filePaths[0];
  });

  const window = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#1e1e1e', autoHideMenuBar: true,
    webPreferences: { preload: path.join(import.meta.dirname, 'preload.cjs') },
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
}).catch(err => {
  dialog.showErrorBox('Batch Recompressor could not start', String(err?.stack ?? err));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
