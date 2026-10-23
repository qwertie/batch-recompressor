// Exposes the DesktopHost API to the shared client; bundled to CommonJS because sandboxed
// preload scripts cannot be ES modules.
import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_HOST_GLOBAL, PICK_FOLDER_CHANNEL, type DesktopHost } from '../shared/desktop.js';

const host: DesktopHost = {
  pickFolder: defaultPath => ipcRenderer.invoke(PICK_FOLDER_CHANNEL, defaultPath),
};
contextBridge.exposeInMainWorld(DESKTOP_HOST_GLOBAL, host);
