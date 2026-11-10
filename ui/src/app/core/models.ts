// Shapes of the JSON the local server sends (src/server/api.ts in the repository root).

export const OPEN_STATUSES: readonly string[] = ['backlog', 'todo', 'doing', 'blocked'];

export interface Project {
  id: string;
  prefix: string;
  name: string;
  release: string;
  state?: string;
  kind?: string;
  summary?: string;
  repos?: string[];
  notion?: string;
  /** The fixed inbox and general areas. */
  reserved: boolean;
  /** Items per status, archived ones left out. */
  counts: Partial<Record<string, number>>;
}

export interface Problem {
  file: string;
  message: string;
}

export interface Space {
  dir: string;
  schemaVersion: number;
  projects: Project[];
  readOnly: boolean;
  problems: Problem[];
  problemCount: number;
  watching: boolean;
  /** Changes whenever any file of the data space changes. */
  stamp: string;
}

export interface GitStatus {
  repository: boolean;
  upstream: boolean;
  unpushed: number | null;
  oldestUnpushed: string | null;
  uncommitted: string[];
  /** The backup is far enough behind for the board to warn. */
  stale: boolean;
}

/** Header of an item. Values are text or lists of text, as in the file. */
export interface ItemFields {
  id: string;
  title: string;
  kind: string;
  status: string;
  since: string;
  created: string;
  priority?: string;
  reason?: string;
  evidence?: string;
  release?: string;
  parent?: string;
  related?: string[];
  labels?: string[];
  links?: string[];
  aliases?: string[];
  supersededBy?: string;
}

export interface Step {
  /** 1-based position among the item's steps. */
  index: number;
  line: number;
  checked: boolean;
  skipped: boolean;
  text: string;
}

export interface Progress {
  total: number;
  done: number;
  skipped: number;
}

/** An item as a card shows it: no body. */
export interface ItemSummary {
  id: string;
  project: string;
  file: string;
  archived: boolean;
  /** Version of the file, sent back as If-Match to change it. */
  etag: string;
  fields: ItemFields;
  progress: Progress;
}

export interface ItemDetail extends ItemSummary {
  body: string;
  steps: Step[];
  children: ItemSummary[];
}

export interface HistoryEntry {
  hash: string;
  date: string;
  subject: string;
}

/** What a write returns. */
export interface WriteResult {
  id?: string;
  message: string;
  hint?: string | null;
  commit: { committed: boolean; hash?: string; reason?: string } | null;
  item: ItemDetail | null;
  moved?: [string, string][];
}

/** Open items of a project: what is still to do. */
export function openCount(project: Pick<Project, 'counts'>): number {
  return OPEN_STATUSES.reduce((sum, status) => sum + (project.counts[status] ?? 0), 0);
}
