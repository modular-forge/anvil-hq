// Guards for the local server. The server listens on 127.0.0.1 only, but any web page open in the
// browser can still send requests to it. These checks keep other pages out:
// - Host must name this server, which defeats DNS rebinding (a foreign name resolving to 127.0.0.1).
// - Origin and Sec-Fetch-Site, when the browser sends them, must say the request comes from the
//   board itself. No CORS headers are ever sent, so other origins cannot read responses either.
// - Every API request carries the session token in a header. The token reaches the browser in the
//   URL fragment, which is never sent to a server or written to logs, and a page from another
//   origin cannot read it.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export const TOKEN_HEADER = 'x-anvil-token';

/** A new random session token: 256 bits, URL-safe. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Compares in constant time; hashing first hides the token's length too. */
export function tokenMatches(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const digest = (text: string) => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(given), digest(token));
}

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function allowedOrigins(port: number): string[] {
  return allowedHosts(port).map((host) => `http://${host}`);
}

export interface Refusal {
  status: number;
  message: string;
}

/** Checks that apply to every request, static files included. */
export function checkRequest(headers: IncomingHttpHeaders, port: number): Refusal | null {
  const host = headers.host?.toLowerCase();
  if (!host || !allowedHosts(port).includes(host)) {
    return { status: 403, message: 'unexpected Host header: open the board at the URL that `anvil serve` printed' };
  }
  const origin = headers.origin;
  if (origin !== undefined && !allowedOrigins(port).includes(origin)) {
    return { status: 403, message: 'requests from other origins are not allowed' };
  }
  // same-site covers other ports of localhost: another local app is still another origin.
  const site = headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') {
    return { status: 403, message: 'requests from other sites are not allowed' };
  }
  return null;
}

/** Checks that apply to API requests on top of checkRequest. */
export function checkApi(method: string, headers: IncomingHttpHeaders, token: string): Refusal | null {
  const given = headers[TOKEN_HEADER];
  if (typeof given !== 'string' || !tokenMatches(given, token)) {
    return { status: 401, message: 'missing or wrong token: open the board at the URL that `anvil serve` printed' };
  }
  // A body that is not JSON could come from a plain HTML form; only JSON is accepted.
  if (method === 'POST' || method === 'PATCH' || method === 'PUT') {
    const type = headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') return { status: 415, message: 'request bodies must be application/json' };
  }
  return null;
}

/** Headers sent with every response. The board needs nothing from other origins. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    // Angular adds component styles at runtime as <style> elements.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    // Angular's <base href="/">: without it, app routes like /projects/x would load /projects/main.js.
    "base-uri 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};
