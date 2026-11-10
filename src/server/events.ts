// Tells open boards when the data space changes on disk: a Claude session, the CLI or an editor
// may write it at any time. fs.watch feeds a Server-Sent Events stream. If watching is not
// possible, or fails later, the stream says so and the board falls back to polling the space's
// stamp (see api.ts).

import { watch, type FSWatcher } from 'node:fs';
import type { ServerResponse } from 'node:http';

export interface FeedOptions {
  /** false skips fs.watch, as if it were unavailable. */
  watch?: boolean;
  /** Changes closer together than this are sent as one event. */
  debounceMs?: number;
  /** A comment line keeps idle connections open through proxies and sleep. */
  heartbeatMs?: number;
}

export class ChangeFeed {
  #dir: string;
  #watcher: FSWatcher | null = null;
  #clients = new Set<ServerResponse>();
  #pending = new Set<string>();
  #timer: NodeJS.Timeout | null = null;
  #heartbeat: NodeJS.Timeout | null = null;
  #debounceMs: number;
  #watching = false;

  constructor(dir: string, { watch: enabled = true, debounceMs = 100, heartbeatMs = 25_000 }: FeedOptions = {}) {
    this.#dir = dir;
    this.#debounceMs = debounceMs;
    if (enabled) this.#start();
    this.#heartbeat = setInterval(() => this.#send(': ping\n\n'), heartbeatMs);
    this.#heartbeat.unref();
  }

  /** True while fs.watch reports changes; false means boards must poll. */
  get watching(): boolean {
    return this.#watching;
  }

  /** Turns `res` into an event stream. The first event tells whether to poll. */
  subscribe(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(event('hello', { watching: this.#watching }));
    this.#clients.add(res);
    res.on('close', () => this.#clients.delete(res));
  }

  close(): void {
    this.#watcher?.close();
    this.#watcher = null;
    this.#watching = false;
    if (this.#timer) clearTimeout(this.#timer);
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    for (const res of this.#clients) res.end();
    this.#clients.clear();
  }

  #start(): void {
    try {
      this.#watcher = watch(this.#dir, { recursive: true }, (_type, name) => this.#changed(name));
      this.#watcher.on('error', () => this.#fallBack());
      this.#watching = true;
    } catch {
      this.#fallBack();
    }
  }

  #fallBack(): void {
    this.#watcher?.close();
    this.#watcher = null;
    this.#watching = false;
    this.#send(event('mode', { watching: false }));
  }

  /** `name` is relative to the data space; null when the platform does not say. */
  #changed(name: string | null): void {
    if (name !== null) {
      const path = name.replaceAll('\\', '/');
      if (!isDataPath(path)) return;
      this.#pending.add(path);
    }
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const paths = [...this.#pending].sort();
      this.#pending.clear();
      this.#send(event('change', { paths }));
    }, this.#debounceMs);
  }

  #send(text: string): void {
    for (const res of this.#clients) res.write(text);
  }
}

/**
 * The registry, and files under projects/ that are not hidden: atomic writes go through hidden
 * temp files, and only the final rename matters. Folders count too, since a deleted folder
 * reports only its own name on some platforms.
 */
export function isDataPath(path: string): boolean {
  if (path === 'projects.json') return true;
  if (path !== 'projects' && !path.startsWith('projects/')) return false;
  return !path.split('/').some((segment) => segment.startsWith('.'));
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}
