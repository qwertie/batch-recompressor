import express from 'express';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scanFolder } from './scan.js';
import { EncodeQueue } from './queue.js';
import { revealInFileManager, shellOpen } from './shell.js';
import type { EnqueueRequest, JobState } from '../shared/types.js';

const app = express();
app.use(express.json({ limit: '50mb' }));

const queue = new EncodeQueue();

// POST /api/scan { folder, outputFolder, exclusions, extensions } -> MediaFileInfo[]
app.post('/api/scan', async (req, res) => {
  const { folder, outputFolder = '', exclusions = [], extensions } = req.body ?? {};
  if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    res.status(400).json({ error: `Not a folder: ${folder}` });
    return;
  }
  try {
    res.json(await scanFolder(folder, outputFolder, exclusions, extensions));
  } catch (err: any) {
    res.status(500).json({ error: String(err.message ?? err) });
  }
});

// POST /api/enqueue { files: [{info, settings}], outputFolder } — add jobs to the queue
app.post('/api/enqueue', (req, res) => {
  const body = req.body as EnqueueRequest;
  if (!body?.outputFolder) {
    res.status(400).json({ error: 'outputFolder is required' });
    return;
  }
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

app.post('/api/queue/stop', (req, res) => {
  res.json({ ok: true, stopped: queue.stopCurrent(req.body?.deletePartial !== false) });
});

app.post('/api/queue/cancel', (_req, res) => {
  queue.cancelPending();
  res.json({ ok: true });
});

app.post('/api/jobs/clear', (req, res) => {
  queue.clear(req.body?.paths ?? []);
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

// Serve the built client, if present.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT ?? 5177);
app.listen(PORT, () => console.log(
  `batch-recompressor server on http://localhost:${PORT}` +
  (fs.existsSync(dist) ? '' : ' (API only — run `npm run dev` for the UI, or `npm run build` first)')));
