// Zero-dependency static server for local use: `bun run start` → http://localhost:8090
import { stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';

const root = import.meta.dir;
const port = Number(process.env.PORT ?? 8090);

const server = Bun.serve({
  port,
  async fetch(req) {
    let pathname = decodeURIComponent(new URL(req.url).pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const filePath = normalize(join(root, pathname));
    if (!filePath.startsWith(root + '/')) return new Response('Forbidden', { status: 403 });
    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) return new Response('Not found', { status: 404 });
    return new Response(Bun.file(filePath), { headers: { 'Cache-Control': 'no-cache' } });
  },
});

console.log(`Read Aloud is running at http://localhost:${server.port}/  (Ctrl+C to stop)`);
