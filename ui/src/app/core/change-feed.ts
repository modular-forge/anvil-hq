import { Injectable } from '@angular/core';
import { TOKEN_HEADER } from './token';

export type FeedEvent =
  | { type: 'hello'; watching: boolean }
  | { type: 'mode'; watching: boolean }
  | { type: 'change'; paths: string[] };

export interface FeedHandlers {
  onEvent: (event: FeedEvent) => void;
  /** The stream could not be opened or broke; it is retried with a growing delay, except on 401. */
  onDown: (status: number | null) => void;
}

const FIRST_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

/**
 * Splits Server-Sent Events text into events. Returns the parsed events and the unfinished rest,
 * to be prepended to the next chunk. Comments and unknown events are skipped.
 */
export function parseEvents(text: string): { events: FeedEvent[]; rest: string } {
  const blocks = text.replaceAll('\r\n', '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: FeedEvent[] = [];
  for (const block of blocks) {
    let name = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    const event = toEvent(name, data);
    if (event) events.push(event);
  }
  return { events, rest };
}

function toEvent(name: string, data: string): FeedEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const watching = record['watching'];
  if ((name === 'hello' || name === 'mode') && typeof watching === 'boolean') return { type: name, watching };
  const paths = record['paths'];
  if (name === 'change' && Array.isArray(paths)) {
    return { type: 'change', paths: paths.filter((p): p is string => typeof p === 'string') };
  }
  return null;
}

/**
 * Reads the server's change stream. EventSource cannot send headers, and the token must not go
 * in a URL, so the stream is read with fetch.
 */
@Injectable({ providedIn: 'root' })
export class ChangeFeed {
  /** Opens the stream and keeps it open until the returned function is called. */
  connect(token: string, handlers: FeedHandlers): () => void {
    const controller = new AbortController();
    let retry = FIRST_RETRY_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const open = async (): Promise<void> => {
      let status: number | null = null;
      try {
        const response = await fetch('/api/events', {
          headers: { [TOKEN_HEADER]: token },
          signal: controller.signal,
          cache: 'no-store',
        });
        status = response.status;
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
        retry = FIRST_RETRY_MS;
        const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const parsed = parseEvents(buffer + value);
          buffer = parsed.rest;
          for (const event of parsed.events) handlers.onEvent(event);
        }
      } catch {
        // Aborted, refused or broken: handled below.
      }
      if (controller.signal.aborted) return;
      handlers.onDown(status);
      if (status === 401) return;
      timer = setTimeout(() => void open(), retry);
      retry = Math.min(retry * 2, MAX_RETRY_MS);
    };

    void open();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }
}
