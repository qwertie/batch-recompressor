import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startServer } from './app.js';

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.env.PORT ?? 5177);
await startServer(PORT, dist);
console.log(
  `batch-recompressor server on http://localhost:${PORT}` +
  (fs.existsSync(dist) ? '' : ' (API only — run `npm run dev` for the UI, or `npm run build` first)'));
