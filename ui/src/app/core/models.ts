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

/** Open items of a project: what is still to do. */
export function openCount(project: Pick<Project, 'counts'>): number {
  return OPEN_STATUSES.reduce((sum, status) => sum + (project.counts[status] ?? 0), 0);
}
