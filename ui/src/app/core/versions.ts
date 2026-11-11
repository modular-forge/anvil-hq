// Release versions: comparing them, the last one of a project, and the next ones to suggest.

import type { ItemSummary } from './models';

/** Compares dotted versions number by number: 1.10 > 1.9. Text parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const diff = Number.isNaN(nx) || Number.isNaN(ny) ? x.localeCompare(y) : nx - ny;
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The highest `release` among `items` of `project`, or null. */
export function lastRelease(items: readonly ItemSummary[], project: string): string | null {
  const versions = items.filter((i) => i.project === project && i.fields.release).map((i) => i.fields.release as string);
  return versions.sort(compareVersions).at(-1) ?? null;
}

export interface Suggestion {
  kind: 'patch' | 'minor' | 'major';
  version: string;
}

/** Patch, minor and major after `last` (1.10 → 1.10.1, 1.11, 2.0); 0.1 to start. */
export function suggestVersions(last: string | null): Suggestion[] {
  if (!last || !/^\d+(\.\d+)*$/.test(last)) return [{ kind: 'minor', version: '0.1' }];
  const [major = 0, minor = 0, patch = 0] = last.split('.').map(Number);
  return [
    { kind: 'patch', version: `${major}.${minor}.${patch + 1}` },
    { kind: 'minor', version: `${major}.${minor + 1}` },
    { kind: 'major', version: `${major + 1}.0` },
  ];
}
