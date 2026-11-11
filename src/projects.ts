// Project operations: create, change (state, name…), scaffold from a template, promote an idea,
// release a version and link a repository. Like store.ts, they validate before writing and return the touched paths.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_ROOT } from './data-dir.ts';
import { AnvilError } from './errors.ts';
import { writeAtomic } from './fsutil.ts';
import { originUrl, repoSlug, repositoryRoot, resolveCommit } from './git.ts';
import { checkRelease, type ReleaseCheck } from './release-git.ts';
import { serializeItem } from './item.ts';
import { validateSchema, type Schema } from './json-schema.ts';
import { normalizeProject, writeRegistry } from './registry.ts';
import { absolute, createItem, getItem, getProject, moveItem, openSpace, today } from './store.ts';
import { OPEN_STATUSES } from './rules.ts';
import type { Change, Context, ItemEntry, ItemFields, Project } from './types.ts';
import { itemProblems } from './validate.ts';

const templateSchema = JSON.parse(readFileSync(join(TOOL_ROOT, 'schema', 'template.schema.json'), 'utf8')) as Schema;
const RELEASABLE_KINDS: ReadonlySet<string> = new Set(['task', 'feature', 'bug']);

export interface TemplateItem {
  kind: string;
  title: string;
  priority?: string;
  labels?: string[];
  body?: string;
  steps?: string[];
}

export interface NewProject {
  id?: string | undefined;
  prefix?: string | undefined;
  name?: string | undefined;
  summary?: string | undefined;
  state?: string | undefined;
  kind?: string | undefined;
  release?: string | undefined;
  repos?: string[];
  notion?: string | undefined;
}

/** Adds a project to projects.json. */
export function createProject(ctx: Context, { id, prefix, name, summary, state = 'idea', kind, release, repos = [], notion }: NewProject): Change & { id: string } {
  if (!id) throw new AnvilError('a new project needs --id');
  for (const [option, value] of Object.entries({ prefix, kind, release })) {
    if (!value) throw new AnvilError(`a new project needs --${option}`);
  }
  const registry = structuredClone(ctx.space.registry);
  registry.projects.push(normalizeProject({ id, prefix, name: name || id, summary, state, kind, release, repos, notion }));
  const path = writeRegistry(ctx, registry);
  return { id, paths: [path], message: `${id}: create project` };
}

/** Fields of a registered project that `project set` changes. Id, prefix and release stay. */
export const PROJECT_SETTABLE = ['state', 'name', 'summary', 'kind', 'notion'] as const;
export type ProjectChanges = Partial<Record<(typeof PROJECT_SETTABLE)[number], string>>;

/** Fields a project must keep: an empty value would remove them. */
const PROJECT_REQUIRED: ReadonlySet<string> = new Set(['state', 'name', 'kind']);
const OPEN_LIST_LIMIT = 5;

/**
 * Changes fields of a registered project; an empty summary or notion removes it. A project is
 * not done while it has open items, as an item is not done with open steps or tasks; it may be
 * cancelled, and the hint lists what stays open.
 */
export function setProject(ctx: Context, id: string, changes: ProjectChanges): Change & { id: string } {
  const keys = Object.keys(changes).filter((key) => changes[key as keyof ProjectChanges] !== undefined);
  if (!keys.length) throw new AnvilError(`nothing to set; use one of ${PROJECT_SETTABLE.map((k) => `--${k}`).join(', ')}`);
  const registry = structuredClone(ctx.space.registry);
  const index = registry.projects.findIndex((p) => p.id === id);
  const current = registry.projects[index];
  if (!current) {
    if (ctx.projects.has(id)) throw new AnvilError(`${id} is a fixed area, not a registered project: it has no fields to set`);
    getProject(ctx, id);
    throw new AnvilError(`unknown project "${id}"`);
  }
  for (const key of keys) {
    if (PROJECT_REQUIRED.has(key) && !changes[key as keyof ProjectChanges]?.trim()) throw new AnvilError(`--${key} cannot be empty`);
  }
  const next = normalizeProject({ ...current, ...Object.fromEntries(keys.map((key) => [key, changes[key as keyof ProjectChanges]?.trim()])) });
  if (JSON.stringify(next) === JSON.stringify(current)) throw new AnvilError(`${id} already has those values`);

  const open = ctx.space.items
    .filter((entry) => entry.project === id && !entry.archived && OPEN_STATUSES.includes(entry.item.fields.status))
    .map((entry) => entry.item.fields.id);
  const list = (ids: string[]) => `${ids.slice(0, OPEN_LIST_LIMIT).join(', ')}${ids.length > OPEN_LIST_LIMIT ? ` and ${ids.length - OPEN_LIST_LIMIT} more` : ''}`;
  if (next.state === 'done' && current.state !== 'done' && open.length) {
    throw new AnvilError(`${id} cannot be done with ${open.length} open item(s): ${list(open)}. Close or cancel them first, or move them to another project`);
  }
  registry.projects[index] = next;
  const path = writeRegistry(ctx, registry);
  const hint = next.state === 'cancelled' && current.state !== 'cancelled' && open.length
    ? `${open.length} item(s) stay open in ${id}: ${list(open)}. Cancel them or move them to another project`
    : null;
  return { id, paths: [path], message: `${id}: set ${keys.join(', ')}`, hint };
}

/**
 * Creates the starting items of the project's kind. A template item is skipped when the project
 * already has an item with the same title (archive included), so scaffolding twice is harmless.
 */
export function scaffoldProject(ctx: Context, projectId: string, now: Date): Change & { id: string; template: string | null; created: string[]; skipped: string[] } {
  const project = getProject(ctx, projectId);
  const { items: templateItems, source } = loadTemplate(ctx.dir, project.kind ?? '');
  const existing = new Set(ctx.space.items.filter((e) => e.project === project.id).map((e) => e.item.fields.title.toLowerCase()));

  const created: { id: string; paths: string[] }[] = [];
  const skipped: string[] = [];
  for (const template of templateItems) {
    if (existing.has(template.title.toLowerCase())) {
      skipped.push(template.title);
      continue;
    }
    const { steps = [], ...rest } = template;
    created.push(createItem(ctx, { ...rest, project: project.id, steps }, now));
    existing.add(template.title.toLowerCase());
  }
  return {
    id: project.id,
    template: source,
    created: created.map((c) => c.id),
    skipped,
    paths: created.flatMap((c) => c.paths),
    message: `${project.id}: scaffold ${created.length} item(s) from the ${project.kind} template`,
  };
}

/** Loads templates/<kind>.json from the data space if present, else the built-in one. */
export function loadTemplate(dir: string, kind: string): { items: TemplateItem[]; source: string | null } {
  const own = join(dir, 'templates', `${kind}.json`);
  const file = existsSync(own) ? own : join(TOOL_ROOT, 'templates', `${kind}.json`);
  if (!existsSync(file)) return { items: [], source: null };
  let template: unknown;
  try {
    template = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new AnvilError(`cannot read ${file}: ${(error as Error).message}`);
  }
  const problems = validateSchema(templateSchema, template).map(({ path, message }) => `${path || 'root'} ${message}`);
  if (problems.length) throw new AnvilError(`${file} is not a valid template: ${problems.join('; ')}`);
  return { items: (template as { items: TemplateItem[] }).items, source: file === own ? `templates/${kind}.json` : 'built-in' };
}

/**
 * Turns an idea into a new project in state `idea`: registers the project, moves the idea into it
 * as its first item and scaffolds the starting items.
 */
export function promoteIdea(dir: string, ideaId: string, options: NewProject, now: Date): Change & { id: string; item: string; created: string[] } {
  const ctx = openSpace(dir);
  const entry = getItem(ctx, ideaId);
  if (entry.item.fields.kind !== 'idea') throw new AnvilError(`${entry.item.fields.id} is a ${entry.item.fields.kind}, not an idea`);
  if (entry.archived) throw new AnvilError(`${entry.item.fields.id} is archived and read-only`);

  const project = createProject(ctx, { ...options, name: options.name || entry.item.fields.title, state: 'idea' });
  const moved = moveItem(openSpace(dir), entry.item.fields.id, project.id);
  const scaffold = scaffoldProject(openSpace(dir), project.id, now);
  return {
    id: project.id,
    item: moved.id,
    created: scaffold.created,
    paths: [...project.paths, ...moved.paths, ...scaffold.paths],
    message: `${entry.item.fields.id}: promote to project ${project.id}`,
  };
}

export interface ReleaseResult extends Change {
  id: string;
  version: string;
  dryRun: boolean;
  released: string[];
  notes: string;
  /** With a git ref: what git said about each done item. */
  checks?: ReleaseCheck[];
}

export interface ReleaseOptions {
  exclude?: string[];
  dryRun?: boolean;
  /**
   * Check the done items against a commit of one of the project's repositories: `dir` is a
   * folder inside it and `ref` the version's tag, branch or hash. Items whose evidence names a
   * PR or commit the version does not have stay done; items git cannot tell about are released.
   */
  git?: { dir: string; ref: string };
}

/**
 * Marks the project's done tasks, features and bugs as released in `version`, except `exclude`
 * and, with `git`, the ones whose work is not in the version yet. Returns the release notes with
 * the result. With `dryRun`, validates and builds the notes without writing.
 */
export function releaseProject(ctx: Context, projectId: string, version: string, { exclude = [], dryRun = false, git }: ReleaseOptions = {}, now: Date): ReleaseResult {
  const project = getProject(ctx, projectId);
  if (project.release !== 'versioned') throw new AnvilError(`project "${project.id}" is not versioned, so nothing is released`);
  if (!version) throw new AnvilError('a release needs a version');

  const done = ctx.space.items.filter((e) => e.project === project.id && !e.archived
    && e.item.fields.status === 'done' && RELEASABLE_KINDS.has(e.item.fields.kind));
  const doneIds = new Set(done.map((e) => e.item.fields.id));
  const unknown = exclude.filter((id) => !doneIds.has(id));
  if (unknown.length) throw new AnvilError(`cannot exclude ${unknown.join(', ')}: not a done item of ${project.id}`);
  let selected = done.filter((e) => !exclude.includes(e.item.fields.id));

  let checks: ReleaseCheck[] | undefined;
  if (git) {
    checks = checkAgainstGit(project, git, selected.map((e) => e.item.fields));
    const held = new Set(checks.filter((c) => c.verdict === 'out').map((c) => c.id));
    selected = selected.filter((e) => !held.has(e.item.fields.id));
  }
  if (!selected.length) {
    throw new AnvilError(checks?.length
      ? `none of ${project.id}'s done items is in ${git?.ref}: ${checks.map((c) => `${c.id} (${c.detail})`).join('; ')}`
      : `${project.id} has no done items to release`);
  }

  const date = today(now);
  const updates = selected.map((entry) => {
    const fields: ItemFields = { ...entry.item.fields, status: 'released', since: date, release: version };
    const problems = itemProblems(fields, project);
    if (problems.length) throw new AnvilError(`${fields.id} cannot be released: ${problems.join('; ')}`);
    return { entry, fields };
  });
  if (!dryRun) for (const { entry, fields } of updates) writeItem(ctx, entry, fields);

  return {
    id: project.id,
    version,
    dryRun,
    released: updates.map(({ fields }) => fields.id),
    notes: releaseNotes(project, version, date, updates.map(({ fields }) => fields)),
    paths: dryRun ? [] : updates.map(({ entry }) => entry.file),
    message: `${project.id}: release ${version} (${updates.length} item(s))`,
    ...(checks ? { checks } : {}),
  };
}

/** Finds the project's repository around `dir`, resolves `ref` in it and checks the items. */
function checkAgainstGit(project: Project, { dir, ref }: { dir: string; ref: string }, items: ItemFields[]): ReleaseCheck[] {
  const root = repositoryRoot(dir);
  if (!root) throw new AnvilError(`to check against ${ref}, run the release inside a repository of ${project.id}`);
  const slug = repoSlug(originUrl(root));
  const repos = project.repos ?? [];
  const ours = readMarker(root) === project.id || (slug !== null && repos.some((r) => r.toLowerCase() === slug.toLowerCase()));
  if (!ours) throw new AnvilError(`${slug ?? root} is not a repository of ${project.id}; run the release inside one of: ${repos.join(', ') || '(none registered; see anvil project link)'}`);
  const commit = resolveCommit(root, ref);
  if (!commit) throw new AnvilError(`"${ref}" is not a tag, branch or commit of ${slug ?? root}`);
  return checkRelease(root, commit, slug, repos, items);
}

/** Markdown release notes: features and fixes with their tasks, then other changes. */
export function releaseNotes(project: Pick<Project, 'id'> & { name?: string }, version: string, date: string, items: ItemFields[]): string {
  const ids = new Set(items.map((f) => f.id));
  const line = (f: ItemFields) => `- ${f.title} (${f.id})`;
  const childrenOf = (parent: ItemFields) => items.filter((f) => f.parent === parent.id).map((f) => `  ${line(f)}`);
  const section = (title: string, entries: string[]) => (entries.length ? [`### ${title}`, '', ...entries, ''] : []);
  const group = (kind: string) => items.filter((f) => f.kind === kind).flatMap((f) => [line(f), ...childrenOf(f)]);
  const other = items.filter((f) => f.kind === 'task' && !(f.parent && ids.has(f.parent))).map(line);
  return [
    `## ${project.name ?? project.id} ${version} (${date})`,
    '',
    ...section('Features', group('feature')),
    ...section('Fixes', group('bug')),
    ...section('Other changes', other),
  ].join('\n');
}

export interface LinkOptions {
  id?: string | undefined;
  prefix?: string | undefined;
  name?: string | undefined;
  kind?: string | undefined;
  release?: string | undefined;
  state?: string | undefined;
}

/**
 * Registers the project of the git repository at `cwd` in this data space, or adds the
 * repository to an existing project. The project id comes from the repository's .anvil.json
 * marker, from `id`, or from the repository name.
 */
export function linkProject(ctx: Context, cwd: string, { id, prefix, name, kind, release, state = 'active' }: LinkOptions = {}): Change & { id: string; linked: boolean } {
  const root = repositoryRoot(cwd);
  if (!root) throw new AnvilError('the current folder is not inside a git repository');
  const markerId = readMarker(root);
  const slug = repoSlug(originUrl(root));
  const projectId = markerId ?? id ?? slug?.split('/')[1]?.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!projectId) throw new AnvilError('cannot tell the project: pass --id, or add an origin remote or an .anvil.json marker');

  const registry = structuredClone(ctx.space.registry);
  const index = registry.projects.findIndex((p) => p.id === projectId || (slug !== null && p.repos?.includes(slug)));
  const existing = registry.projects[index];
  if (existing) {
    if (!slug || existing.repos?.includes(slug)) {
      return { id: existing.id, linked: false, paths: [], message: `${existing.id}: already linked` };
    }
    registry.projects[index] = normalizeProject({ ...existing, repos: [...(existing.repos ?? []), slug] });
    return { id: existing.id, linked: true, paths: [writeRegistry(ctx, registry)], message: `${existing.id}: link ${slug}` };
  }
  for (const [option, value] of Object.entries({ prefix, kind, release })) {
    if (!value) throw new AnvilError(`"${projectId}" is not in this data space yet; to add it, pass --${option}`);
  }
  registry.projects.push(normalizeProject({ id: projectId, prefix, name: name || projectId, state, kind, release, repos: slug ? [slug] : [] }));
  return { id: projectId, linked: true, paths: [writeRegistry(ctx, registry)], message: `${projectId}: create project from ${slug ?? root}` };
}

/** The project id in the repository's .anvil.json marker, or null without one. */
export function readMarker(root: string): string | null {
  const file = join(root, '.anvil.json');
  if (!existsSync(file)) return null;
  let marker: { project?: unknown };
  try {
    marker = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new AnvilError(`cannot read ${file}: ${(error as Error).message}`);
  }
  if (typeof marker.project !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(marker.project)) {
    throw new AnvilError(`${file} must be { "project": "<id>" }`);
  }
  return marker.project;
}

function writeItem(ctx: Context, entry: ItemEntry, fields: ItemFields): void {
  writeAtomic(absolute(ctx, entry.file), serializeItem({ fields, body: entry.item.body }), { expectMtimeMs: entry.mtimeMs });
}
