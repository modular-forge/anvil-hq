import { TOKEN_KEY, captureToken, readToken } from './token';

function place(hash: string) {
  const replaceState = vi.fn();
  return { location: { hash, pathname: '/projects/alpha', search: '?x=1' }, history: { replaceState } };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    setItem: (key: string, value: string) => values.set(key, value),
    getItem: (key: string) => values.get(key) ?? null,
  };
}

describe('session token', () => {
  it('moves the token from the fragment to storage and clears the address bar', () => {
    const at = place('#token=abc_DEF-123');
    const storage = memoryStorage();
    captureToken(at, storage);
    expect(storage.values.get(TOKEN_KEY)).toBe('abc_DEF-123');
    expect(at.history.replaceState).toHaveBeenCalledWith(null, '', '/projects/alpha?x=1');
    expect(readToken(storage)).toBe('abc_DEF-123');
  });

  it('finds the token among other fragment parameters', () => {
    const storage = memoryStorage();
    captureToken(place('#a=1&token=xyz'), storage);
    expect(readToken(storage)).toBe('xyz');
  });

  it('leaves the URL alone when there is no token', () => {
    const at = place('#section');
    const storage = memoryStorage();
    captureToken(at, storage);
    expect(at.history.replaceState).not.toHaveBeenCalled();
    expect(readToken(storage)).toBeNull();
  });

  it('still clears the URL when storage is blocked, and reads nothing', () => {
    const at = place('#token=abc');
    const blocked = {
      setItem: () => {
        throw new Error('blocked');
      },
      getItem: () => {
        throw new Error('blocked');
      },
    };
    captureToken(at, blocked);
    expect(at.history.replaceState).toHaveBeenCalled();
    expect(readToken(blocked)).toBeNull();
    expect(readToken(null)).toBeNull();
  });
});
