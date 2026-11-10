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
import { SECURITY_HEADERS, checkApi, checkRequest, newToken, type Refusal } from './security.ts';
import { staticFile } from './static.ts';

export const DEFAULT_PORT = 4747;
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
}: ServerOptions): Promise<RunningServer> {
  const feed = new ChangeFeed(dir, { watch });
  let actualPort = port;

  const server = createServer((req, res) => {
    try {
      handle(req, res);
    } catch (error) {
      if (res.headersSent) {
        res.end();
      } else if (error instanceof AnvilError) {
        // The data space cannot be read right now, for example a broken projects.json.
        send(res, req, { status: 503, body: { error: error.message } });
      } else {
        logError(error);
        send(res, req, { status: 500, body: { error: 'internal error; see the terminal running anvil serve' } });
      }
    }
  });

  function handle(req: IncomingMessage, res: ServerResponse): void {
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
      if (method !== 'GET' && method !== 'HEAD') return refuse(res, req, { status: 405, message: `${method} is not supported here` });
      if (url.pathname === '/api/events') return feed.subscribe(res);
      // Route on the raw path: ids and dates are decoded segment by segment.
      const response = readRoute({ dir, watching: feed.watching }, url.pathname, url.searchParams);
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

/** Sends a JSON response; honours If-None-Match when the response has an ETag. */
function send(res: ServerResponse, req: IncomingMessage, { status, body, etag }: ApiResponse): void {
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
