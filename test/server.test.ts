import assert from 'node:assert/strict';
import { request } from 'node:http';
import { utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { isDataPath } from '../src/server/events.ts';
import { tokenMatches } from '../src/server/security.ts';
import { startServer, type ServerOptions } from '../src/server/server.ts';
import { startTestServer } from './server-support.ts';
import { item, itemText, fields, makeSpace, type SpaceFiles } from './support.ts';

const FILES: SpaceFiles = {
  ...item('alpha', 'AL-1', { kind: 'feature', status: 'doing', aliases: ['BE-7'] }, '- [x] One\n- [ ] Two\n- [x] ~~Three~~ (skipped: not needed)\n'),
  ...item('alpha', 'AL-2', { parent: 'AL-1' }),
  ...item('alpha', 'AL-3', { status: 'cancelled', reason: 'Not wanted' }),
  'projects/alpha/archive/2025/AL-4.md': itemText(fields('AL-4', { status: 'done', evidence: 'PR 4' })),
  ...item('beta', 'BE-1', { title: 'Find the needle here' }),
  ...item('inbox', 'IN-1', { kind: 'idea', status: 'backlog' }),
  'projects/alpha/journal/2026-11-09.md': '## 10:00\n\nTalked about AL-1 and the needle.\n',
};

const serve = (t: TestContext, files: SpaceFiles = FILES, options: Partial<ServerOptions> = {}) => startTestServer(t, files, options);

describe('server security', () => {
  it('rejects API requests without the right token', async (t) => {
    const { call } = await serve(t);
    assert.equal((await call('/api/space', { token: false })).status, 401);
    assert.equal((await call('/api/space', { token: 'wrong' })).status, 401);
    assert.equal((await call('/api/space')).status, 200);
    assert.equal((await call('/api/nope')).status, 404);
  });

  it('rejects a foreign Host header (DNS rebinding), even with the token', async (t) => {
    const { call, server } = await serve(t);
    for (const host of ['evil.example', `evil.example:${server.port}`, `127.0.0.1:${server.port + 1}`]) {
      assert.equal((await call('/api/space', { headers: { host } })).status, 403, host);
      assert.equal((await call('/', { headers: { host } })).status, 403, host);
    }
    assert.equal((await call('/api/space', { headers: { host: `localhost:${server.port}` } })).status, 200);
  });

  it('rejects other origins and cross-site requests, and sends no CORS headers', async (t) => {
    const { call, server } = await serve(t);
    const foreign = await call('/api/space', { headers: { origin: 'http://evil.example' } });
    assert.equal(foreign.status, 403);
    assert.equal(foreign.headers['access-control-allow-origin'], undefined);
    assert.equal((await call('/api/space', { headers: { origin: 'http://localhost:3000' } })).status, 403);
    assert.equal((await call('/api/space', { headers: { 'sec-fetch-site': 'same-site' } })).status, 403);
    assert.equal((await call('/api/space', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    const own = await call('/api/space', { headers: { origin: `http://127.0.0.1:${server.port}`, 'sec-fetch-site': 'same-origin' } });
    assert.equal(own.status, 200);
  });

  it('accepts only JSON bodies, once the token is right, and only the methods each path has', async (t) => {
    const { call } = await serve(t);
    assert.equal((await call('/api/items', { method: 'POST', body: 'a=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await call('/api/items', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } })).status, 415);
    assert.equal((await call('/api/items', { method: 'POST', body: '{}', token: false, headers: { 'content-type': 'application/json' } })).status, 401);
    assert.equal((await call('/api/items', { method: 'PUT', json: {} })).status, 405);
    assert.equal((await call('/api/items', { method: 'DELETE' })).status, 405);
    assert.equal((await call('/api/space', { method: 'POST', json: {} })).status, 404);
    assert.equal((await call('/', { method: 'DELETE' })).status, 405);
  });

  it('sends the security headers on every response', async (t) => {
    const { call } = await serve(t);
    for (const reply of [await call('/'), await call('/api/space'), await call('/api/space', { token: false })]) {
      assert.match(String(reply.headers['content-security-policy']), /default-src 'self'.*frame-ancestors 'none'/);
      assert.match(String(reply.headers['content-security-policy']), /base-uri 'self'/);
      assert.equal(reply.headers['x-content-type-options'], 'nosniff');
      assert.equal(reply.headers['referrer-policy'], 'no-referrer');
    }
    assert.equal((await call('/api/space')).headers['cache-control'], 'no-store');
  });

  it('compares tokens without accepting empty or partial ones', () => {
    assert.equal(tokenMatches('abc', 'abc'), true);
    assert.equal(tokenMatches('ab', 'abc'), false);
    assert.equal(tokenMatches('', 'abc'), false);
    assert.equal(tokenMatches(undefined, 'abc'), false);
  });
});

describe('server static files', () => {
  it('serves the board, its assets, and index.html for app routes', async (t) => {
    const { call } = await serve(t);
    const home = await call('/');
    assert.equal(home.status, 200);
    assert.match(String(home.headers['content-type']), /text\/html/);
    assert.match(home.text, /<title>board<\/title>/);
    assert.match((await call('/projects/alpha')).text, /<title>board<\/title>/);
    const script = await call('/assets/main.js');
    assert.equal(script.status, 200);
    assert.match(String(script.headers['content-type']), /text\/javascript/);
  });

  it('never serves dotfiles, unknown types or anything outside the board', async (t) => {
    const { call } = await serve(t);
    for (const path of ['/.env', '/../secret.txt', '/..%2Fsecret.txt', '/%2e%2e/secret.txt', '/assets/..%5C..%5Csecret.txt', '/missing.js', '/index.exe', '/%E0%A4%A']) {
      const reply = await call(path);
      assert.ok(reply.status === 404 || reply.status === 400, `${path} → ${reply.status}`);
      assert.doesNotMatch(reply.text, /SECRET|outside/, path);
    }
  });

  it('shows a placeholder until the board is built', async (t) => {
    const { call } = await serve(t, FILES, { staticDir: join(tmpdir(), 'anvil-no-such-folder') });
    const reply = await call('/');
    assert.equal(reply.status, 200);
    assert.match(reply.text, /has not been built yet/);
  });
});

describe('server read API', () => {
  it('describes the space: projects with counts, validity and a stamp', async (t) => {
    const { call, dir } = await serve(t);
    const space = (await call('/api/space')).json();
    assert.equal(space.readOnly, false);
    assert.equal(space.problemCount, 0);
    assert.equal(space.watching, true);
    assert.equal(space.dir, dir);
    const alpha = space.projects.find((p: { id: string }) => p.id === 'alpha');
    assert.deepEqual(alpha.counts, { doing: 1, todo: 1, cancelled: 1 });
    assert.equal(alpha.reserved, false);
    assert.equal(space.projects.find((p: { id: string }) => p.id === 'inbox').reserved, true);

    const before = space.stamp;
    writeFileSync(join(dir, 'projects/alpha/journal/2026-11-09.md'), '## 10:00\n\nChanged.\n');
    assert.notEqual((await call('/api/space')).json().stamp, before);
  });

  it('is read-only while the space does not validate', async (t) => {
    const { call } = await serve(t, { ...FILES, ...item('alpha', 'AL-9', { kind: 'chore' }) });
    const space = (await call('/api/space')).json();
    assert.equal(space.readOnly, true);
    assert.ok(space.problems.some((p: { file: string }) => p.file === 'projects/alpha/items/AL-9.md'));
  });

  it('answers 503 when projects.json cannot be read', async (t) => {
    const { call, errors } = await serve(t, { ...FILES, 'projects.json': '{ broken' });
    const reply = await call('/api/space');
    assert.equal(reply.status, 503);
    assert.match(reply.json().error, /projects\.json/);
    assert.deepEqual(errors, []);
  });

  it('lists items without cancelled or archived ones, unless all=1', async (t) => {
    const { call } = await serve(t);
    const ids = (path: string) => call(path).then((r) => r.json().map((i: { id: string }) => i.id).sort());
    assert.deepEqual(await ids('/api/items?project=alpha'), ['AL-1', 'AL-2']);
    assert.deepEqual(await ids('/api/items?project=alpha&all=1'), ['AL-1', 'AL-2', 'AL-3', 'AL-4']);
    assert.deepEqual(await ids('/api/items'), ['AL-1', 'AL-2', 'BE-1', 'IN-1']);
    assert.equal((await call('/api/items?project=nope')).status, 404);

    const [first] = (await call('/api/items?project=alpha')).json();
    assert.deepEqual(first.progress, { total: 3, done: 1, skipped: 1 });
    assert.equal(first.body, undefined);
  });

  it('returns an item with its body, steps and child tasks, by id or alias', async (t) => {
    const { call } = await serve(t);
    const reply = await call('/api/items/AL-1');
    assert.equal(reply.status, 200);
    const detail = reply.json();
    assert.equal(detail.fields.title, 'Item AL-1');
    assert.equal(detail.steps.length, 3);
    assert.equal(detail.steps[2].skipped, true);
    assert.deepEqual(detail.children.map((c: { id: string }) => c.id), ['AL-2']);
    assert.equal(reply.headers.etag, detail.etag);

    assert.equal((await call('/api/items/BE-7')).json().id, 'AL-1');
    assert.equal((await call('/api/items/AL-99')).status, 404);
    assert.equal((await call('/api/items/%E0%A4%A')).status, 400);
  });

  it('answers 304 when the item has not changed, and a new ETag when it has', async (t) => {
    const { call, dir } = await serve(t);
    const { etag } = (await call('/api/items/AL-2')).headers;
    assert.ok(etag);
    assert.equal((await call('/api/items/AL-2', { headers: { 'if-none-match': etag } })).status, 304);
    const file = join(dir, 'projects/alpha/items/AL-2.md');
    writeFileSync(file, itemText(fields('AL-2', { parent: 'AL-1', title: 'Renamed' })));
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const changed = await call('/api/items/AL-2', { headers: { 'if-none-match': etag } });
    assert.equal(changed.status, 200);
    assert.equal(changed.json().fields.title, 'Renamed');
  });

  it('lists and reads journal notes, only those the space has', async (t) => {
    const { call } = await serve(t);
    assert.deepEqual((await call('/api/projects/alpha/journal')).json(), [{ date: '2026-11-09', file: 'projects/alpha/journal/2026-11-09.md' }]);
    const note = (await call('/api/projects/alpha/journal/2026-11-09')).json();
    assert.match(note.text, /Talked about AL-1/);
    assert.equal((await call('/api/projects/alpha/journal/2026-11-08')).status, 404);
    assert.equal((await call('/api/projects/alpha/journal/..%2F..%2Fprojects.json')).status, 404);
    assert.equal((await call('/api/projects/nope/journal')).status, 404);
  });

  it('searches items and journal notes', async (t) => {
    const { call } = await serve(t);
    const found = (await call('/api/search?q=needle')).json();
    assert.deepEqual(found.items.map((i: { id: string }) => i.id), ['BE-1']);
    assert.equal(found.journal.length, 1);
    assert.equal((await call('/api/search?q=needle&project=alpha')).json().items.length, 0);
    assert.equal((await call('/api/search')).status, 400);
    assert.equal((await call(`/api/search?q=${'x'.repeat(201)}`)).status, 400);
  });
});

describe('server change feed', () => {
  /** Opens the event stream and collects its text until `until` matches or the time runs out. */
  async function stream(port: number, onOpen: () => void, until: RegExp): Promise<string> {
    return new Promise((resolve, reject) => {
      let text = '';
      let opened = false;
      const req = request({ host: '127.0.0.1', port, path: '/api/events', headers: { 'x-anvil-token': 'test-token' } }, (res) => {
        assert.match(String(res.headers['content-type']), /text\/event-stream/);
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
          if (!opened && text.includes('event: hello')) {
            opened = true;
            onOpen();
          }
          if (until.test(text)) {
            clearTimeout(timer);
            req.destroy();
            resolve(text);
          }
        });
      });
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error(`timed out; got:\n${text}`));
      }, 8000);
      req.on('error', (error) => { if (!until.test(text)) reject(error); });
      req.end();
    });
  }

  it('announces changes to data files, not to hidden temp files', async (t) => {
    const { server, dir } = await serve(t);
    const text = await stream(server.port, () => {
      // Give the watcher a moment to settle before writing.
      setTimeout(() => {
        writeFileSync(join(dir, 'projects/alpha/items/.AL-2.md.abcd.tmp'), 'temp');
        writeFileSync(join(dir, 'projects/alpha/items/AL-5.md'), itemText(fields('AL-5')));
      }, 100);
    }, /event: change\ndata: .*AL-5\.md/);
    assert.match(text, /^event: hello\ndata: {"watching":true}/);
    assert.doesNotMatch(text, /\.tmp/);
  });

  it('tells boards to poll when it is not watching', async (t) => {
    const { server, call } = await serve(t, FILES, { watch: false });
    const text = await stream(server.port, () => {}, /event: hello\ndata: .*\n\n/);
    assert.match(text, /{"watching":false}/);
    assert.equal((await call('/api/space')).json().watching, false);
  });

  it('only counts the registry and visible files under projects/', () => {
    assert.equal(isDataPath('projects.json'), true);
    assert.equal(isDataPath('projects/alpha/items/AL-1.md'), true);
    assert.equal(isDataPath('projects/alpha'), true);
    assert.equal(isDataPath('projects/alpha/items/.AL-1.md.1a2b.tmp'), false);
    assert.equal(isDataPath('.git/index'), false);
    assert.equal(isDataPath('README.md'), false);
  });
});

describe('server start', () => {
  it('refuses a port already in use with a clear message', async (t) => {
    const { server, dir } = await serve(t);
    await assert.rejects(startServer({ dir, port: server.port, watch: false }), /already in use/);
  });

  it('prints a URL with the token in the fragment only', async (t) => {
    const { server } = await serve(t);
    assert.equal(server.url, `http://127.0.0.1:${server.port}/#token=test-token`);
    const random = await startServer({ dir: makeSpace(t, {}), port: 0, watch: false });
    t.after(() => random.close());
    assert.match(random.token, /^[A-Za-z0-9_-]{43}$/);
  });
});
