import { HttpClient, type HttpInterceptorFn } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { GitStatus, Space } from './models';
import { TOKEN_HEADER, readToken, sessionStore } from './token';

/** Adds the session token to every API request. */
export const tokenInterceptor: HttpInterceptorFn = (req, next) => {
  const token = readToken(sessionStore());
  if (!token || !req.url.startsWith('/api/')) return next(req);
  return next(req.clone({ setHeaders: { [TOKEN_HEADER]: token } }));
};

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
}
