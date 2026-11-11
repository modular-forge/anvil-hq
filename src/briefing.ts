// `anvil briefing`: a short Markdown summary of the open items of the project the current folder
// belongs to. Meant for a Claude Code SessionStart hook, so it must stay short and never fail.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { originUrl, repoSlug, repositoryRoot, unpushedCount } from './git.ts';
import { readMarker } from './projects.ts';
import type { Context, Item, Project } from './types.ts';

const LIST_LIMIT = 10;
const JOURNAL_CHARS = 400;

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
    ...list('Doing', inStatus('doing')),
    ...list('Blocked', inStatus('blocked'), (item) => ` (${item.fields.reason})`),
    ...list('Todo', inStatus('todo')),
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
