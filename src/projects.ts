// Project operations: create, scaffold from a template, promote an idea, release a version and
// link a repository. Like store.ts, they validate before writing and return the touched paths.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_ROOT } from './data-dir.ts';
import { AnvilError } from './errors.ts';
import { writeAtomic } from './fsutil.ts';
import { originUrl, repoSlug, repositoryRoot } from './git.ts';
import { serializeItem } from './item.ts';
import { validateSchema, type Schema } from './json-schema.ts';
import { normalizeProject, writeRegistry } from './registry.ts';
import { absolute, createItem, getItem, getProject, moveItem, openSpace, today } from './store.ts';
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
}

/**
 * Marks the project's done tasks, features and bugs as released in `version`, except `exclude`,
 * and returns the release notes with the result. With `dryRun`, validates and builds the notes
 * without writing.
 */
export function releaseProject(ctx: Context, projectId: string, version: string, { exclude = [], dryRun = false }: { exclude?: string[]; dryRun?: boolean } = {}, now: Date): ReleaseResult {
  const project = getProject(ctx, projectId);
  if (project.release !== 'versioned') throw new AnvilError(`project "${project.id}" is not versioned, so nothing is released`);
  if (!version) throw new AnvilError('a release needs a version');

  const done = ctx.space.items.filter((e) => e.project === project.id && !e.archived
    && e.item.fields.status === 'done' && RELEASABLE_KINDS.has(e.item.fields.kind));
  const doneIds = new Set(done.map((e) => e.item.fields.id));
  const unknown = exclude.filter((id) => !doneIds.has(id));
  if (unknown.length) throw new AnvilError(`cannot exclude ${unknown.join(', ')}: not a done item of ${project.id}`);
  const selected = done.filter((e) => !exclude.includes(e.item.fields.id));
  if (!selected.length) throw new AnvilError(`${project.id} has no done items to release`);

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
  };
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
