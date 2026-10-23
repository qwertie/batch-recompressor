import express from 'express';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { Server } from 'node:http';
import { EncodeQueue } from './queue.js';
import { AppStateStore, StateConflict } from './state.js';
import { revealInFileManager, shellOpen } from './shell.js';
import type { JobState } from '../shared/types.js';
import type { StateCommand } from '../shared/state.js';

/** Express app with every `/api` route; module-level so its queue and state are singletons. */
const app = express();
app.use(express.json({ limit: '50mb' }));

const queue = new EncodeQueue();
const stateFile = process.env.BATCH_RECOMPRESSOR_STATE_FILE
  ?? path.join(os.homedir(), '.batch-recompressor', 'state.json');
const state = new AppStateStore(queue, { stateFile });

app.get('/api/state', (_req, res) => res.json(state.snapshot()));

app.post('/api/state', async (req, res) => {
  try {
    const snapshot = await state.dispatch(
      req.body?.command as StateCommand,
      Number(req.body?.revision),
    );
    const structural = ['addFolder', 'rescan', 'clearAll', 'clearUnqueued']
      .includes(req.body?.command?.type);
    res.json(structural
      ? snapshot
      : {
        revision: snapshot.revision,
        existingOutputs: snapshot.existingOutputs,
      });
  } catch (err: any) {
    res.status(err instanceof StateConflict ? 409 : 400).json({
      error: String(err.message ?? err),
      revision: state.snapshot().revision,
    });
  }
});

// POST /api/enqueue { paths } — server resolves authoritative metadata/settings.
app.post('/api/enqueue', (req, res) => {
  let body;
  try {
    body = state.enqueueRequest(req.body?.paths ?? []);
  } catch (err: any) {
    res.status(err instanceof StateConflict ? 409 : 400)
      .json({ error: String(err.message ?? err) });
    return;
  }
  if (!body?.outputFolder) {
    res.status(400).json({ error: 'outputFolder is required' });
    return;
  }
  queue.setMaxConcurrent(body.maxConcurrent ?? 1);
  for (const f of body.files ?? []) {
    queue.enqueue({
      info: f.info,
      outputFolder: body.outputFolder,
      settings: f.settings,
      overwrite: body.overwrite,
    });
  }
  res.json({ ok: true });
});

// POST /api/unqueue { paths: string[] } — remove/cancel jobs
app.post('/api/unqueue', (req, res) => {
  for (const p of req.body?.paths ?? []) queue.unqueue(p, req.body?.deletePartial !== false);
  res.json({ ok: true });
});

// POST /api/reveal { path } — select a file in the platform file manager
app.post('/api/reveal', async (req, res) => {
  const filePath = String(req.body?.path ?? '');
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: `File not found: ${filePath}` });
    return;
  }
  try {
    await revealInFileManager(filePath);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({
      error: `Could not reveal ${filePath}: ${String(err.message ?? err)}`,
    });
  }
});

// POST /api/open { path } — open a file with its platform-associated app
app.post('/api/open', async (req, res) => {
  const filePath = String(req.body?.path ?? '');
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: `File not found: ${filePath}` });
    return;
  }
  try {
    await shellOpen(filePath);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({
      error: `Could not open ${filePath}: ${String(err.message ?? err)}`,
    });
  }
});

// GET /api/jobs — current state of all known jobs
app.get('/api/jobs', (_req, res) => res.json(queue.getStates()));

// GET /api/events — Server-Sent Events stream of JobState updates
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (state: JobState) => res.write(`data: ${JSON.stringify(state)}\n\n`);
  for (const s of queue.getStates()) send(s);
  queue.on('update', send);
  req.on('close', () => queue.off('update', send));
});

/**
 * Starts listening for API requests, also serving the built client from `distDir` if that
 * exists. Used by both the web server (`server/index.ts`) and the Electron main process.
 * `host` defaults to all interfaces; port 0 picks a free port, which the returned server's
 * `address()` reports.
 */
export function startServer(port: number, distDir: string, host?: string): Promise<Server> {
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }
  return new Promise((resolve, reject) => {
    const server = app.listen({ port, host }, () => resolve(server));
    server.once('error', reject);
  });
}
