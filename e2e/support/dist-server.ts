/** Serves a built dist/ directory over HTTP, so e2e tests exercise the same
 * self-contained HTML the app ships — not source files, not file://. */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export interface DistServer {
  origin: string;
  close(): Promise<void>;
}

export function startDistServer(dir: string): Promise<DistServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      // Don't trust the request path outside dir.
      const safePath = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      const filePath = join(dir, safePath);
      readFile(filePath)
        .then((body) => {
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[extname(filePath)] ?? 'application/octet-stream',
          });
          res.end(body);
        })
        .catch(() => {
          res.writeHead(404);
          res.end('Not found');
        });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('dist server: could not determine listening port'));
        return;
      }
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}
