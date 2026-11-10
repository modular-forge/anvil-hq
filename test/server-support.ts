// Helpers for the server tests: a real server on a free port over a made-up data space, and raw
// HTTP calls, so headers such as Host can be set freely.

import { request, type IncomingHttpHeaders } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { startServer, type ServerOptions } from '../src/server/server.ts';
import { makeSpace, type SpaceFiles } from './support.ts';

export const TOKEN = 'test-token';

export interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: () => any;
}

export interface Call {
  method?: string;
  headers?: Record<string, string>;
  /** Raw body text. */
  body?: string;
  /** A body sent as JSON, with its Content-Type. */
  json?: unknown;
  /** false: send no token header. */
  token?: false | string;
}

/** Starts a server on a free port over a made-up data space; stops it after the test. */
export async function startTestServer(t: TestContext, files: SpaceFiles, options: Partial<ServerOptions> & { dir?: string } = {}) {
  const dir = options.dir ?? makeSpace(t, files);
  const errors: unknown[] = [];
  const server = await startServer({ dir, port: 0, token: TOKEN, staticDir: board(t), logError: (e) => errors.push(e), ...options });
  t.after(() => server.close());
  const call = (path: string, { method = 'GET', headers = {}, body, json, token = TOKEN }: Call = {}) => new Promise<Reply>((resolve, reject) => {
    const all: Record<string, string> = {
      ...(token === false ? {} : { 'x-anvil-token': token }),
      ...(json === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    };
    const req = request({ host: '127.0.0.1', port: server.port, path, method, headers: all }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(json === undefined ? body : JSON.stringify(json));
  });
  return { dir, server, call, errors };
}

/** A built board: index.html and one script, next to a file that must never be served. */
function board(t: TestContext): string {
  const base = mkdtempSync(join(tmpdir(), 'anvil-board-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'ui-dist');
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>board</title>');
  writeFileSync(join(root, 'assets', 'main.js'), 'console.log(1);');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  writeFileSync(join(base, 'secret.txt'), 'outside');
  return root;
}
