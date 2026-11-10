// Serves the built board (ui-dist/) and nothing else: known file types only, no dotfiles, never
// outside the folder. Paths without an extension are routes of the single-page app and get
// index.html. Until the board is built, a placeholder page says so.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, posix, relative } from 'node:path';

const TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

export interface StaticFile {
  status: 200 | 404;
  type: string;
  body: Buffer;
}

const PLACEHOLDER = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>anvil</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0E0F12;color:#ECEDEF;font-family:system-ui,sans-serif">
<main style="max-width:32rem;padding:16px;line-height:1.5">
<h1 style="font-size:1.5rem">anvil</h1>
<p>The server is running, but the board has not been built yet (<code>ui-dist/</code> is missing).</p>
</main>
</body>
</html>
`;

const NOT_FOUND: StaticFile = { status: 404, type: TYPES['.txt'] ?? 'text/plain', body: Buffer.from('Not found\n') };

/**
 * The file for a request path (already decoded, starting with /). `root` is the built board's
 * folder, which may not exist yet.
 */
export function staticFile(root: string, pathname: string): StaticFile {
  if (pathname.includes('\0') || pathname.includes('\\')) return NOT_FOUND;
  const clean = posix.normalize(pathname);
  if (clean.split('/').some((segment) => segment.startsWith('.'))) return NOT_FOUND;

  const ext = extname(clean);
  if (ext === '') return page(root);
  const type = TYPES[ext];
  if (!type) return NOT_FOUND;
  const file = join(root, clean);
  if (!isInside(root, file) || !isFile(file)) return NOT_FOUND;
  return { status: 200, type, body: readFileSync(file) };
}

/** index.html of the built board, or the placeholder. */
function page(root: string): StaticFile {
  const index = join(root, 'index.html');
  const body = isFile(index) ? readFileSync(index) : Buffer.from(PLACEHOLDER);
  return { status: 200, type: TYPES['.html'] ?? 'text/html', body };
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isInside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}
