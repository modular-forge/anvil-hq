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

/** What a push from the board did: how many commits went up, and the git status after it. */
export interface PushResult {
  pushed: number;
  git: GitStatus;
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
  /** The body without its steps: what the description editor shows and saves. */
  description: string;
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

export interface JournalNote {
  date: string;
  file: string;
}

export interface JournalText extends JournalNote {
  text: string;
}

export interface SearchResult {
  items: { id: string; status: string; title: string; file: string; archived: boolean }[];
  journal: { file: string; line: number; text: string }[];
}

/** What creating an item, publishing a release or promoting an idea returns. */
export interface CreateResult extends WriteResult {
  id: string;
  file?: string;
}

export interface ReleaseResult extends WriteResult {
  id: string;
  version: string;
  dryRun: boolean;
  released: string[];
  notes: string;
}

export interface NewItem {
  project: string;
  kind: string;
  title: string;
  status?: string;
  parent?: string;
  priority?: string;
  labels?: string[];
  steps?: string[];
  body?: string;
}

export interface NewProject {
  id: string;
  prefix: string;
  kind: string;
  release: string;
  name?: string;
}

/** Open items of a project: what is still to do. */
export function openCount(project: Pick<Project, 'counts'>): number {
  return OPEN_STATUSES.reduce((sum, status) => sum + (project.counts[status] ?? 0), 0);
}
