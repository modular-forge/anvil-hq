// The data model. Header values are read as text and only trusted after validation, so the
// fields keep plain string types; the unions below name the values the schemas allow.

export type ItemKind = 'task' | 'feature' | 'bug' | 'decision' | 'idea';
export type Status = 'backlog' | 'todo' | 'doing' | 'blocked' | 'done' | 'released' | 'cancelled';
export type ProjectKind = 'web' | 'mobile' | 'server' | 'tooling';
export type ReleaseMode = 'versioned' | 'none';

/** A header value: one line of text, or a list of them. */
export type HeaderValue = string | string[];
export type Header = Record<string, HeaderValue>;

/** Header of an item file. Read from disk, so any field may be missing until validated. */
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
  [key: string]: HeaderValue | undefined;
}

export interface Step {
  /** 1-based position among the item's steps. */
  index: number;
  /** 0-based line of the body. */
  line: number;
  checked: boolean;
  skipped: boolean;
  text: string;
}

export interface Item {
  fields: ItemFields;
  body: string;
  steps: Step[];
}

/** An item file as found in the data space. */
export interface ItemEntry {
  /** Relative to the data space, with forward slashes. */
  file: string;
  project: string;
  archived: boolean;
  year: string | null;
  mtimeMs: number;
  item: Item;
}

export interface Project {
  id: string;
  prefix: string;
  name: string;
  release: string;
  summary?: string;
  state?: string;
  kind?: string;
  repos?: string[];
  notion?: string;
}

export interface Registry {
  $schema?: string;
  schemaVersion: number;
  archiveAfterDays?: number;
  projects: Project[];
}

export interface JournalNote {
  file: string;
  project: string;
  name: string;
}

export interface FileProblem {
  file: string;
  message: string;
}

export interface Space {
  registry: Registry | null;
  registryError: string | null;
  folders: string[];
  items: ItemEntry[];
  journals: JournalNote[];
  unreadable: FileProblem[];
}

/** A data space read once for one operation. */
export interface Context {
  dir: string;
  space: Space & { registry: Registry };
  registryMtimeMs: number | null;
  projects: Map<string, Project>;
  byId: Map<string, ItemEntry>;
}

/** What every operation that writes returns: the relative paths it touched and a commit message. */
export interface Change {
  paths: string[];
  message: string;
  hint?: string | null;
}

export interface CommitResult {
  committed: boolean;
  hash?: string;
  reason?: string;
}
