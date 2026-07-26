import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const execFileP = promisify(execFile);

/** Open a file with the operating system's associated application. */
export async function shellOpen(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    await execFileP('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Invoke-Item -LiteralPath $env:BATCH_RECOMPRESSOR_OPEN_PATH',
    ], {
      windowsHide: true,
      env: { ...process.env, BATCH_RECOMPRESSOR_OPEN_PATH: filePath },
    });
    return;
  }
  if (process.platform === 'darwin') {
    await execFileP('open', [filePath]);
    return;
  }
  await execFileP('xdg-open', [filePath]);
}

export function explorerSelectArgument(filePath: string): string {
  return `/select,"${path.win32.normalize(filePath)}"`;
}

function spawnExplorer(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Explorer parses this switch from the raw command line: the comma and
    // quoted path must remain together rather than becoming separate argv
    // entries. Windows paths cannot contain double-quote characters.
    const child = spawn('explorer.exe', [explorerSelectArgument(filePath)], {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: true,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

/** Reveal and select a file in Explorer, Finder, or a Linux file manager. */
export async function revealInFileManager(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    await spawnExplorer(filePath);
    return;
  }
  if (process.platform === 'darwin') {
    await execFileP('open', ['-R', filePath]);
    return;
  }

  // FileManager1 is supported by Nautilus and several other Linux file
  // managers. Fall back to opening the parent folder when it is unavailable.
  const uri = pathToFileURL(filePath).href;
  try {
    await execFileP('dbus-send', [
      '--session',
      '--print-reply',
      '--dest=org.freedesktop.FileManager1',
      '--type=method_call',
      '/org/freedesktop/FileManager1',
      'org.freedesktop.FileManager1.ShowItems',
      `array:string:${uri}`,
      'string:',
    ]);
  } catch {
    await execFileP('xdg-open', [path.dirname(filePath)]);
  }
}
