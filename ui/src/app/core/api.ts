import { HttpClient, HttpErrorResponse, HttpHeaders, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, type Observable } from 'rxjs';
import type { GitStatus, HistoryEntry, ItemDetail, ItemSummary, Space, WriteResult } from './models';
import { TOKEN_HEADER, readToken, sessionStore } from './token';

/** Adds the session token to every API request. */
export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = readToken(sessionStore());
  if (!token || !req.url.startsWith('/api/')) return next(req);
  return next(req.clone({ setHeaders: { [TOKEN_HEADER]: token } }));
};

/**
 * A write the server refused. `status` 409 means the item changed on disk since the board read
 * it, and `current` is the item as it is now; 422 means a rule prevents it, with the same message
 * as the CLI; 423 means the data space is read-only until it validates.
 */
export class WriteError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly current: ItemDetail | null = null,
  ) {
    super(message);
    this.name = 'WriteError';
  }
}

export interface StatusChange {
  status: string;
  reason?: string;
  evidence?: string;
}

export type StepAction = 'check' | 'uncheck' | 'skip';

/** The board's calls to the local server. */
@Injectable({ providedIn: 'root' })
export class Api {
  readonly #http = inject(HttpClient);

  space(): Promise<Space> {
    return firstValueFrom(this.#http.get<Space>('/api/space'));
  }

  git(): Promise<GitStatus> {
    return firstValueFrom(this.#http.get<GitStatus>('/api/git'));
  }

  /** Items of a project, cancelled and archived ones included. */
  items(project: string): Promise<ItemSummary[]> {
    return firstValueFrom(this.#http.get<ItemSummary[]>('/api/items', { params: { project, all: '1' } }));
  }

  item(id: string): Promise<ItemDetail> {
    return firstValueFrom(this.#http.get<ItemDetail>(`/api/items/${encodeURIComponent(id)}`));
  }

  history(id: string): Promise<HistoryEntry[]> {
    return firstValueFrom(this.#http.get<HistoryEntry[]>(`/api/items/${encodeURIComponent(id)}/history`));
  }

  setStatus(item: Pick<ItemSummary, 'id' | 'etag'>, change: StatusChange): Promise<WriteResult> {
    return this.#write(this.#http.post<WriteResult>(`${itemUrl(item.id)}/status`, change, ifMatch(item.etag)));
  }

  changeStep(item: Pick<ItemSummary, 'id' | 'etag'>, n: number, action: StepAction, reason?: string): Promise<WriteResult> {
    return this.#write(this.#http.post<WriteResult>(`${itemUrl(item.id)}/steps/${n}`, { action, reason }, ifMatch(item.etag)));
  }

  addStep(item: Pick<ItemSummary, 'id' | 'etag'>, text: string): Promise<WriteResult> {
    return this.#write(this.#http.post<WriteResult>(`${itemUrl(item.id)}/steps`, { text }, ifMatch(item.etag)));
  }

  move(item: Pick<ItemSummary, 'id' | 'etag'>, project: string): Promise<WriteResult> {
    return this.#write(this.#http.post<WriteResult>(`${itemUrl(item.id)}/move`, { project }, ifMatch(item.etag)));
  }

  async #write(request: Observable<WriteResult>): Promise<WriteResult> {
    try {
      return await firstValueFrom(request);
    } catch (error) {
      throw toWriteError(error);
    }
  }
}

function itemUrl(id: string): string {
  return `/api/items/${encodeURIComponent(id)}`;
}

function ifMatch(etag: string): { headers: HttpHeaders } {
  return { headers: new HttpHeaders({ 'If-Match': etag }) };
}

/** Turns an HTTP failure into a WriteError with the server's message. */
export function toWriteError(error: unknown): WriteError {
  if (!(error instanceof HttpErrorResponse)) return new WriteError('Something went wrong; see the browser console.', 0);
  const body: unknown = error.error;
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const message = typeof record['error'] === 'string' ? record['error'] : error.status === 0 ? 'anvil serve is not answering.' : error.message;
  const current = error.status === 409 && typeof record['current'] === 'object' ? (record['current'] as ItemDetail | null) : null;
  return new WriteError(message, error.status, current);
}
