// The local server behind the board: the built UI, a JSON API under /api and an event stream of
// changes on disk. It listens on 127.0.0.1 only; see security.ts for what keeps other pages out.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { TOOL_ROOT } from '../data-dir.ts';
import { AnvilError } from '../errors.ts';
import { errorCode } from '../fsutil.ts';
import { readRoute, type ApiResponse } from './api.ts';
import { ChangeFeed } from './events.ts';
import { writeRoute, type Body } from './writes.ts';
import { SECURITY_HEADERS, checkApi, checkRequest, newToken, type Refusal } from './security.ts';
import { staticFile } from './static.ts';

export const DEFAULT_PORT = 4747;
/** Largest request body accepted; an item with a long body fits many times over. */
export const MAX_BODY_BYTES = 256 * 1024;
const HOST = '127.0.0.1';

export interface ServerOptions {
  /** The data space, already resolved and checked by resolveDataDir. */
  dir: string;
  /** 0 picks a free port (tests). */
  port?: number;
  token?: string;
  /** The built board; defaults to ui-dist/ in this repository. */
  staticDir?: string;
  /** false: do not watch the data space, boards poll instead. */
  watch?: boolean;
  /** Where unexpected errors are reported; requests only ever get a generic message. */
  logError?: (error: unknown) => void;
  /** The clock for dates written to items and the journal (tests). */
  now?: () => Date;
}

export interface RunningServer {
  port: number;
  token: string;
  /** The board's address, token included in the fragment. */
  url: string;
  close(): Promise<void>;
}

export async function startServer({
  dir,
  port = DEFAULT_PORT,
  token = newToken(),
  staticDir = join(TOOL_ROOT, 'ui-dist'),
  watch = true,
  logError = (error) => console.error(error),
  now = () => new Date(),
}: ServerOptions): Promise<RunningServer> {
  const feed = new ChangeFeed(dir, { watch });
  let actualPort = port;

  const server = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      if (res.headersSent) {
        res.end();
      } else if (error instanceof AnvilError) {
        // The data space cannot be read right now, for example a broken projects.json.
        send(res, req, { status: 503, body: { error: error.message } });
      } else {
        logError(error);
        send(res, req, { status: 500, body: { error: 'internal error; see the terminal running anvil serve' } });
      }
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const refusal = checkRequest(req.headers, actualPort);
    if (refusal) return refuse(res, req, refusal);

    const url = new URL(req.url ?? '/', `http://${HOST}`);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return refuse(res, req, { status: 400, message: 'malformed path' });
    }

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const apiRefusal = checkApi(method, req.headers, token);
      if (apiRefusal) return refuse(res, req, apiRefusal);
      // Route on the raw path: ids and dates are decoded segment by segment.
      if (method === 'GET' || method === 'HEAD') {
        if (url.pathname === '/api/events') return feed.subscribe(res);
        const response = readRoute({ dir, watching: feed.watching }, url.pathname, url.searchParams, now());
        return send(res, req, response ?? { status: 404, body: { error: 'no such API route' } });
      }
      if (method !== 'POST' && method !== 'PATCH') return refuse(res, req, { status: 405, message: `${method} is not supported here` });
      const body = await readBody(req);
      if ('status' in body) return refuse(res, req, body);
      const ifMatch = req.headers['if-match'];
      const response = writeRoute({ dir, method, pathname: url.pathname, body: body.json, ifMatch, now: now() });
      return send(res, req, response ?? { status: 404, body: { error: 'no such API route' } });
    }

    if (method !== 'GET' && method !== 'HEAD') return refuse(res, req, { status: 405, message: `${method} is not supported here` });
    const file = staticFile(staticDir, pathname);
    res.writeHead(file.status, { ...SECURITY_HEADERS, 'Content-Type': file.type, 'Cache-Control': 'no-cache' });
    res.end(file.body);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', (error) => {
      feed.close();
      reject(errorCode(error) === 'EADDRINUSE'
        ? new AnvilError(`port ${port} is already in use: is another \`anvil serve\` running?`)
        : error);
    });
    server.listen(port, HOST, () => resolve());
  });
  actualPort = (server.address() as AddressInfo).port;

  return {
    port: actualPort,
    token,
    url: `http://${HOST}:${actualPort}/#token=${token}`,
    close: () => new Promise<void>((resolve) => {
      feed.close();
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}

/** Reads a JSON object body, refusing anything too large or malformed. */
async function readBody(req: IncomingMessage): Promise<{ json: Body } | Refusal> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_BODY_BYTES) {
    req.resume();
    return { status: 413, message: `request bodies are limited to ${MAX_BODY_BYTES} bytes` };
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) return { status: 413, message: `request bodies are limited to ${MAX_BODY_BYTES} bytes` };
    chunks.push(chunk as Buffer);
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return { status: 400, message: 'the request body is not valid JSON' };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return { status: 400, message: 'the request body must be a JSON object' };
  return { json: json as Body };
}

/** Sends a JSON response; honours If-None-Match when the response has an ETag. */
function send(res: ServerResponse, req: IncomingMessage, { status, body, etag }: ApiResponse): void {
  // A body nobody read would be taken as the next request on a kept-alive connection.
  if (!req.readableEnded) req.resume();
  const headers: Record<string, string> = { ...SECURITY_HEADERS, 'Cache-Control': 'no-store' };
  if (etag) {
    headers.ETag = etag;
    if (status === 200 && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
  }
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(body)}\n`);
}

function refuse(res: ServerResponse, req: IncomingMessage, { status, message }: Refusal): void {
  send(res, req, { status, body: { error: message } });
}
