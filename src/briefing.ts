// `anvil briefing`: a short Markdown summary of the open items of the project the current folder
// belongs to, after the order of focus across projects. Meant for a Claude Code SessionStart hook, so it must stay short and never fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { originUrl, repoSlug, repositoryRoot, unpushedCount } from './git.ts';
import { readMarker } from './projects.ts';
import type { Context, Item, Project } from './types.ts';

const LIST_LIMIT = 10;
const JOURNAL_CHARS = 400;
const PRIORITY_ORDER = ['high', 'medium', 'low'];

/** Highest priority first; items without one go last. The sort is stable, so ties keep their order. */
function byPriority(a: Item, b: Item): number {
  const rank = (item: Item) => {
    const index = PRIORITY_ORDER.indexOf(item.fields.priority ?? '');
    return index < 0 ? PRIORITY_ORDER.length : index;
  };
  return rank(a) - rank(b);
}

/** What to work on first in a project: what is in doing, else the todo item with the highest priority. */
function nextItem(items: Item[]): Item | undefined {
  return items.find((item) => item.fields.status === 'doing') ?? items.filter((item) => item.fields.status === 'todo').sort(byPriority)[0];
}

/**
 * The order of focus across projects, with what comes first in each and where `project` stands.
 * Nothing when the data space has no order.
 */
function focusLines(ctx: Context, project: Project): string[] {
  const focus = ctx.space.registry.focus ?? [];
  if (!focus.length) return [];
  const lines = focus.map((id, index) => {
    const other = ctx.projects.get(id);
    const next = nextItem(ctx.space.items.filter((e) => e.project === id && !e.archived).map((e) => e.item));
    const mark = id === project.id ? ', this project' : '';
    return `${index + 1}. ${other?.name ?? id} (${id})${mark}${next ? `: ${next.fields.id} ${next.fields.title} (${next.fields.status})` : ''}`;
  });
  const outside = focus.includes(project.id) ? [] : ['This project is not in the order of focus.'];
  return ['## Order of focus across projects', ...lines, ...outside, ''];
}

/** The project of the repository at `cwd`: by its .anvil.json marker, then by its origin remote. */
export function detectProject(ctx: Context, cwd: string): Project | null {
  const root = repositoryRoot(cwd);
  if (!root) return null;
  const markerId = readMarker(root);
  if (markerId) return ctx.projects.get(markerId) ?? null;
  const slug = repoSlug(originUrl(root));
  if (!slug) return null;
  const lower = slug.toLowerCase();
  return [...ctx.projects.values()].find((p) => p.repos?.some((repo) => repo.toLowerCase() === lower)) ?? null;
}

/** Builds the briefing text for `project`. */
export function briefing(ctx: Context, project: Project): string {
  const items = ctx.space.items.filter((e) => e.project === project.id && !e.archived).map((e) => e.item);
  const inStatus = (status: string) => items.filter((item) => item.fields.status === status);
  const progress = (item: Item) => {
    const total = item.steps.length;
    return total ? ` [${item.steps.filter((s) => s.checked).length}/${total}]` : '';
  };
  const list = (title: string, entries: Item[], extra: (item: Item) => string = () => '') => {
    if (!entries.length) return [];
    const shown = entries.slice(0, LIST_LIMIT).map((item) => `- ${item.fields.id} ${item.fields.title}${progress(item)}${extra(item)}`);
    const more = entries.length > LIST_LIMIT ? [`- …and ${entries.length - LIST_LIMIT} more`] : [];
    return [`## ${title}`, ...shown, ...more, ''];
  };

  const lines = [
    `# anvil: ${project.name} (project ${project.id}, prefix ${project.prefix}), ${project.state}`,
    ...(project.summary ? [project.summary] : []),
    ...(project.notion ? [`Notion: ${project.notion}`] : []),
    '',
    ...focusLines(ctx, project),
    ...list('Doing', inStatus('doing')),
    ...list('Blocked', inStatus('blocked'), (item) => ` (${item.fields.reason})`),
    ...list('Todo', inStatus('todo').sort(byPriority)),
  ];
  const backlog = inStatus('backlog').length;
  const inbox = ctx.space.items.filter((e) => e.project === 'inbox' && !e.archived && !['done', 'cancelled'].includes(e.item.fields.status)).length;
  if (backlog || inbox) lines.push(`Backlog: ${backlog} item(s). Inbox: ${inbox} open item(s).`, '');

  const note = ctx.space.journals.filter((n) => n.project === project.id).sort((a, b) => b.name.localeCompare(a.name))[0];
  if (note) {
    const text = readFileSync(join(ctx.dir, note.file), 'utf8').trim();
    const last = text.slice(Math.max(0, text.lastIndexOf('## ')));
    lines.push(`## Last journal note (${note.name.replace(/\.md$/, '')})`, last.length > JOURNAL_CHARS ? `${last.slice(0, JOURNAL_CHARS)}…` : last, '');
  }
  const unpushed = unpushedCount(ctx.dir);
  if (unpushed) lines.push(`The data space has ${unpushed} commit(s) not pushed.`, '');
  lines.push(`Update items with the anvil CLI (\`anvil item status ${project.prefix}-<n> doing\`, \`anvil step check …\`, \`anvil --help\`), not by editing the files: it validates and commits each change.`);
  return `${lines.join('\n')}\n`;
}
