import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { git, space } from '../testing';
import { tokenInterceptor } from './api';
import { ChangeFeed, type FeedHandlers } from './change-feed';
import { POLL_MS, SpaceStore } from './space-store';
import { TOKEN_HEADER, TOKEN_KEY } from './token';

class FakeFeed {
  handlers: FeedHandlers | null = null;
  token: string | null = null;
  stopped = false;
  connect(token: string, handlers: FeedHandlers): () => void {
    this.token = token;
    this.handlers = handlers;
    return () => {
      this.stopped = true;
    };
  }
}

describe('SpaceStore', () => {
  let http: HttpTestingController;
  let feed: FakeFeed;

  beforeEach(() => {
    sessionStorage.clear();
    feed = new FakeFeed();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([tokenInterceptor])),
        provideHttpClientTesting(),
        { provide: ChangeFeed, useValue: feed },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    http.verify();
  });

  /** Answers the pending space and git requests. */
  async function answer(spaceBody = space(), gitBody = git()): Promise<void> {
    const spaceRequest = http.expectOne('/api/space');
    expect(spaceRequest.request.headers.get(TOKEN_HEADER)).toBe('secret');
    spaceRequest.flush(spaceBody);
    http.expectOne('/api/git').flush(gitBody);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('is locked without a token, and asks the server nothing', async () => {
    const store = TestBed.inject(SpaceStore);
    await store.start();
    expect(store.state()).toBe('unauthorized');
    expect(feed.handlers).toBeNull();
  });

  it('loads the space with the token, then follows the change feed', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'secret');
    const store = TestBed.inject(SpaceStore);
    const started = store.start();
    await answer();
    await started;
    expect(store.state()).toBe('ready');
    expect(store.inboxOpen()).toBe(2);
    expect(store.project('alpha')?.name).toBe('Alpha');
    expect(feed.token).toBe('secret');

    feed.handlers?.onEvent({ type: 'change', paths: [] });
    await answer(space({ stamp: 'two', projects: [] }));
    expect(store.projects()).toEqual([]);
  });

  it('locks when the server refuses the token', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'secret');
    const store = TestBed.inject(SpaceStore);
    const started = store.start();
    http.expectOne('/api/space').flush({ error: 'wrong token' }, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/git').flush({ error: 'wrong token' }, { status: 401, statusText: 'Unauthorized' });
    await started;
    expect(store.state()).toBe('unauthorized');
    expect(feed.handlers).toBeNull();
  });

  it('says it is offline when the server does not answer', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'secret');
    const store = TestBed.inject(SpaceStore);
    const started = store.start();
    http.expectOne('/api/space').error(new ProgressEvent('error'));
    http.expectOne('/api/git').error(new ProgressEvent('error'));
    await started;
    expect(store.state()).toBe('offline');
  });

  it('polls every few seconds while the server cannot watch, and stops when it can again', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'secret');
    vi.useFakeTimers();
    const store = TestBed.inject(SpaceStore);
    const started = store.start();
    await answer();
    await started;

    feed.handlers?.onEvent({ type: 'mode', watching: false });
    expect(store.watching()).toBe(false);
    vi.advanceTimersByTime(POLL_MS);
    await answer(space({ stamp: 'two' }));
    expect(store.space()?.stamp).toBe('two');

    feed.handlers?.onEvent({ type: 'hello', watching: true });
    await answer();
    vi.advanceTimersByTime(POLL_MS * 2);
    http.expectNone('/api/space');
  });

  it('locks when the feed is refused, and polls when it is down', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'secret');
    const store = TestBed.inject(SpaceStore);
    const started = store.start();
    await answer();
    await started;
    feed.handlers?.onDown(null);
    expect(store.watching()).toBe(false);
    feed.handlers?.onDown(401);
    expect(store.state()).toBe('unauthorized');
    store.stop();
    expect(feed.stopped).toBe(true);
  });
});
