// The session token printed by `anvil serve` arrives in the URL fragment (#token=…), which the
// browser never sends to a server. It is moved to sessionStorage, so it survives a reload of the
// tab but not the tab itself, and removed from the address bar before the app starts.

export const TOKEN_KEY = 'anvil.token';
export const TOKEN_HEADER = 'X-Anvil-Token';

interface Place {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
}

/** Moves a token from the fragment to `storage`. Call once, before the router starts. */
export function captureToken(place: Place, storage: Pick<Storage, 'setItem'> | null): void {
  const match = /^#(?:.*&)?token=([A-Za-z0-9_-]+)/.exec(place.location.hash);
  if (!match?.[1]) return;
  try {
    storage?.setItem(TOKEN_KEY, match[1]);
  } catch {
    // Storage blocked: the token is lost on reload, and the board says how to get it back.
  }
  place.history.replaceState(null, '', place.location.pathname + place.location.search);
}

/** The stored token, or null when there is none or storage is blocked. */
export function readToken(storage: Pick<Storage, 'getItem'> | null): string | null {
  try {
    return storage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

/** sessionStorage, or null where reading it throws (blocked site data). */
export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
