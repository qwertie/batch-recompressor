// @vitest-environment node
// startServer is what both the web server and the Electron main process run.
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-recompressor-'));
let server: Server | undefined;
afterAll(() => {
  server?.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('startServer', () => {
  it('serves the API and the built client on a free loopback port', async () => {
    process.env.BATCH_RECOMPRESSOR_STATE_FILE = path.join(tempDir, 'state.json');
    const distDir = path.join(tempDir, 'dist');
    fs.mkdirSync(distDir);
    fs.writeFileSync(path.join(distDir, 'index.html'), '<title>client</title>');
    // Imported late because app.js reads the state-file variable at load time.
    const { startServer } = await import('../server/app.js');

    server = await startServer(0, distDir, '127.0.0.1');
    const { address, port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    expect(address).toBe('127.0.0.1');
    expect(port).toBeGreaterThan(0);
    expect((await (await fetch(`${base}/api/state`)).json()).state.rootFolders).toEqual([]);
    expect(await (await fetch(`${base}/some/page`)).text()).toBe('<title>client</title>');
  });
});
