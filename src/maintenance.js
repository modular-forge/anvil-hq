// `anvil archive` and `anvil search`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createExclusive, removeFile } from './fsutil.js';
import { serializeItem } from './item.js';
import { absolute, today } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_ARCHIVE_AFTER_DAYS = 60;

/**
 * Whether an item is in its final status: released in a versioned project, done elsewhere and
 * always for decisions and ideas, or cancelled. Decisions still in force never are.
 */
export function isFinal(fields, project) {
  if (fields.status === 'cancelled') return true;
  if (fields.kind === 'decision') return fields.status === 'done' && Boolean(fields.supersededBy);
  if (fields.kind === 'idea') return fields.status === 'done';
  if (project?.release === 'versioned') return fields.status === 'released';
  return fields.status === 'done';
}

/**
 * Moves items that have been in their final status for `archiveAfterDays` days, counted from
 * `since`, to archive/<year of since>/. With `dryRun`, only lists them.
 */
export function archiveItems(ctx, now, { dryRun = false } = {}) {
  const days = ctx.space.registry.archiveAfterDays ?? DEFAULT_ARCHIVE_AFTER_DAYS;
  const cutoff = toDay(today(now)) - days * DAY_MS;
  const due = ctx.space.items.filter((entry) => !entry.archived
    && isFinal(entry.item.fields, ctx.projects.get(entry.project))
    && toDay(entry.item.fields.since) <= cutoff);

  const moves = due.map((entry) => ({
    entry,
    to: `projects/${entry.project}/archive/${entry.item.fields.since.slice(0, 4)}/${entry.item.fields.id}.md`,
  }));
  if (!dryRun) {
    for (const { entry, to } of moves) {
      createExclusive(absolute(ctx, to), serializeItem(entry.item));
      removeFile(absolute(ctx, entry.file));
    }
  }
  return {
    days,
    archived: moves.map(({ entry, to }) => ({ id: entry.item.fields.id, from: entry.file, to })),
    paths: dryRun ? [] : moves.flatMap(({ entry, to }) => [entry.file, to]),
    message: `archive: ${moves.length} item(s)`,
  };
}

/**
 * Case-insensitive search in item ids, titles, labels and bodies, and in journal notes.
 * Archived items only with `includeArchive`.
 */
export function search(ctx, text, { project, includeArchive = false } = {}) {
  const needle = text.toLowerCase();
  const matches = (value) => value.toLowerCase().includes(needle);
  const items = ctx.space.items
    .filter((entry) => (includeArchive || !entry.archived) && (!project || entry.project === project))
    .filter(({ item: { fields, body } }) => [fields.id, fields.title, body, ...(fields.labels ?? []), ...(fields.aliases ?? [])].some(matches))
    .map((entry) => ({ id: entry.item.fields.id, status: entry.item.fields.status, title: entry.item.fields.title, file: entry.file, archived: entry.archived }));

  const journal = ctx.space.journals
    .filter((note) => !project || note.project === project)
    .flatMap((note) => readFileSync(join(ctx.dir, note.file), 'utf8').split('\n')
      .map((line, i) => ({ file: note.file, line: i + 1, text: line.trim() }))
      .filter((hit) => matches(hit.text)));
  return { items, journal };
}

function toDay(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
