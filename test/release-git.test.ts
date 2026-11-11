import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import { main } from '../src/cli.ts';
import { releaseProject } from '../src/projects.ts';
import { evidenceRefs } from '../src/release-git.ts';
import { openSpace } from '../src/store.ts';
import { NOW, REGISTRY, captureIo, initRepo, item, makeSpace } from './support.ts';

describe('evidenceRefs', () => {
  it('finds pull requests, commit hashes and repositories in the evidence', () => {
    assert.deepEqual(evidenceRefs('PR #14 merged (example-org/alpha)'), { prs: [14], commits: [], repos: ['example-org/alpha'] });
    assert.deepEqual(evidenceRefs('merged in #7, see pull request 9').prs, [7, 9]);
    assert.deepEqual(evidenceRefs('https://github.com/Example-Org/Alpha/pull/21'), { prs: [21], commits: [], repos: ['example-org/alpha'] });
    assert.deepEqual(evidenceRefs('fixed in c5b3afa and 1a2b3c4d5e'), { prs: [], commits: ['c5b3afa', '1a2b3c4d5e'], repos: [] });
  });

  it('takes no plain numbers, dates or words for a hash, and finds nothing in a plain note', () => {
    assert.deepEqual(evidenceRefs('released 2026-11-11, build 12345678, decafbad'), { prs: [], commits: [], repos: [] });
    assert.deepEqual(evidenceRefs('confirmed by user (board)'), { prs: [], commits: [], repos: [] });
    assert.deepEqual(evidenceRefs(undefined), { prs: [], commits: [], repos: [] });
  });
});

/**
 * A project repository for alpha, with work before and after the v1.0 tag, and a data space whose
 * done items point at that work in their evidence.
 */
function setup(t: TestContext) {
  const repo = mkdtempSync(join(tmpdir(), 'anvil-project-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = initRepo(repo);
  git('remote', 'add', 'origin', 'https://github.com/example-org/alpha.git');
  const commit = (subject: string) => {
    git('commit', '--quiet', '--allow-empty', '-m', subject);
    return git('rev-parse', 'HEAD').trim();
  };
  commit('Merge pull request #1 from example-org/feat-export');
  commit('Fix the crash on start (#2)');
  const before = commit('Update dependencies');
  git('tag', 'v1.0');
  commit('Merge pull request #3 from example-org/feat-import');
  const after = commit('Tidy the docs');

  const registry = structuredClone(REGISTRY);
  const alpha = registry.projects[0];
  if (alpha) alpha.repos = ['example-org/alpha', 'example-org/alpha-api'];
  const dir = makeSpace(t, {
    'projects.json': registry,
    ...item('alpha', 'AL-1', { kind: 'feature', title: 'Export', status: 'done', evidence: 'PR #1 merged' }),
    ...item('alpha', 'AL-2', { kind: 'bug', title: 'Crash on start', status: 'done', evidence: 'merged in #2' }),
    ...item('alpha', 'AL-3', { title: 'Update dependencies', status: 'done', evidence: `commit ${before.slice(0, 9)}` }),
    ...item('alpha', 'AL-4', { kind: 'feature', title: 'Import', status: 'done', evidence: 'PR #3 merged' }),
    ...item('alpha', 'AL-5', { title: 'Tidy the docs', status: 'done', evidence: after.slice(0, 7) }),
    ...item('alpha', 'AL-6', { title: 'Checked on the phone', status: 'done', evidence: 'confirmed by user (board)' }),
    ...item('alpha', 'AL-7', { title: 'API rate limits', status: 'done', evidence: 'PR #9 in example-org/alpha-api' }),
  });
  return { repo, dir, git };
}

describe('releaseProject against git', () => {
  it('releases what the version has, keeps the rest done and says why for each item', (t) => {
    const { repo, dir } = setup(t);
    const result = releaseProject(openSpace(dir), 'alpha', '1.0', { git: { dir: repo, ref: 'v1.0' } }, NOW);
    assert.deepEqual(result.released, ['AL-1', 'AL-2', 'AL-3', 'AL-6', 'AL-7']);
    assert.deepEqual(result.checks?.map((c) => [c.id, c.verdict]), [
      ['AL-1', 'in'], ['AL-2', 'in'], ['AL-3', 'in'], ['AL-4', 'out'], ['AL-5', 'out'], ['AL-6', 'unverified'], ['AL-7', 'unverified'],
    ]);
    assert.match(result.checks?.[0]?.detail ?? '', /^PR #1 → [0-9a-f]{7}$/);
    assert.equal(result.checks?.[3]?.detail, 'PR #3 not in this version');
    assert.equal(result.checks?.[6]?.detail, 'the evidence is about example-org/alpha-api');
    const statuses = openSpace(dir).space.items.map((e) => [e.item.fields.id, e.item.fields.status]);
    assert.deepEqual(Object.fromEntries(statuses), { 'AL-1': 'released', 'AL-2': 'released', 'AL-3': 'released', 'AL-4': 'done', 'AL-5': 'done', 'AL-6': 'released', 'AL-7': 'released' });
    assert.doesNotMatch(result.notes, /Import|Tidy/);
  });

  it('takes a branch or a commit as well as a tag, and an excluded item is not checked', (t) => {
    const { repo, dir } = setup(t);
    const result = releaseProject(openSpace(dir), 'alpha', '1.1', { git: { dir: join(repo), ref: 'main' }, exclude: ['AL-6'], dryRun: true }, NOW);
    assert.deepEqual(result.released, ['AL-1', 'AL-2', 'AL-3', 'AL-4', 'AL-5', 'AL-7']);
    assert.equal(result.checks?.some((c) => c.id === 'AL-6'), false);
  });

  it('refuses a ref it cannot find, a repository of another project and a folder outside git', (t) => {
    const { repo, dir, git } = setup(t);
    const ctx = openSpace(dir);
    assert.throws(() => releaseProject(ctx, 'alpha', '1.0', { git: { dir: repo, ref: 'v9' } }, NOW), /"v9" is not a tag, branch or commit of example-org\/alpha/);
    assert.throws(() => releaseProject(ctx, 'alpha', '1.0', { git: { dir: repo, ref: '--all' } }, NOW), /is not a tag, branch or commit/);
    git('remote', 'set-url', 'origin', 'https://github.com/example-org/other.git');
    assert.throws(() => releaseProject(ctx, 'alpha', '1.0', { git: { dir: repo, ref: 'v1.0' } }, NOW), /example-org\/other is not a repository of alpha; run the release inside one of: example-org\/alpha, example-org\/alpha-api/);
    const outside = mkdtempSync(join(tmpdir(), 'anvil-plain-'));
    t.after(() => rmSync(outside, { recursive: true, force: true }));
    assert.throws(() => releaseProject(ctx, 'alpha', '1.0', { git: { dir: outside, ref: 'v1.0' } }, NOW), /run the release inside a repository of alpha/);
  });

  it('says which items it held back when none is in the version', (t) => {
    const { repo, dir } = setup(t);
    assert.throws(
      () => releaseProject(openSpace(dir), 'alpha', '1.0', { git: { dir: repo, ref: 'v1.0' }, exclude: ['AL-1', 'AL-2', 'AL-3', 'AL-6', 'AL-7'] }, NOW),
      /none of alpha's done items is in v1.0: AL-4 \(PR #3 not in this version\); AL-5 \(commit [0-9a-f]{7} not in this version\)/,
    );
  });

  it('prints what git said about each item before the summary with --ref, from the current folder', async (t) => {
    const { repo, dir } = setup(t);
    const io = captureIo();
    const code = await main(['project', 'release', 'alpha', '1.0', '--ref', 'v1.0', '--dry-run', '--data', dir], { stdout: io.stdout, stderr: io.stderr, env: {}, cwd: repo, now: () => NOW });
    assert.equal(code, 0, io.out.stderr);
    const lines = io.out.stdout.split('\n');
    assert.match(lines[0] ?? '', /^ {2}AL-1 {2}in this version {5}PR #1 → [0-9a-f]{7}$/);
    assert.match(lines[3] ?? '', /^ {2}AL-4 {2}stays done {10}PR #3 not in this version$/);
    assert.match(lines[5] ?? '', /^ {2}AL-6 {2}released by status {2}no PR or commit in the evidence$/);
    assert.equal(lines[8], 'Would release AL-1, AL-2, AL-3, AL-6, AL-7 in 1.0');
  });
});
