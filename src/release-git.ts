// Which done items went into a version, from the project's git history: an item whose evidence
// names a pull request or a commit is in the version when that merge or commit is part of the
// version's commit (a tag, a branch, a hash). Nothing here needs item ids in commit messages, so
// it works for public repositories too.

import { containsCommit, mergedPullRequests } from './git.ts';
import type { ItemFields } from './types.ts';

/** in: git confirms it; out: it names work the version does not have; unverified: git cannot tell. */
export type ReleaseVerdict = 'in' | 'out' | 'unverified';

export interface ReleaseCheck {
  id: string;
  verdict: ReleaseVerdict;
  /** Why, in a few words: "PR #14 → c5b3afa", "no PR or commit in the evidence"… */
  detail: string;
}

export interface EvidenceRefs {
  prs: number[];
  commits: string[];
  /** owner/name repositories the evidence mentions, lowercased. */
  repos: string[];
}

/** The pull requests, commit hashes and repositories an item's evidence mentions. */
export function evidenceRefs(evidence: string | undefined): EvidenceRefs {
  const text = evidence ?? '';
  const prs = new Set<number>();
  for (const match of text.matchAll(/\b(?:PR|pull request)\s*#?\s*(\d+)\b|(?:^|[\s(,;:])#(\d+)\b|\/pull\/(\d+)\b/gi)) {
    prs.add(Number(match[1] ?? match[2] ?? match[3]));
  }
  const repos = new Set<string>();
  for (const match of text.matchAll(/(?:github\.com\/|\(|\s|^)([A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+?)(?:\.git)?(?=[\s),;:]|\/pull\/|$)/g)) {
    repos.add((match[1] ?? '').toLowerCase());
  }
  // Any hex word of a hash's length is a candidate, numbers and words like "decafbad" included:
  // a real short hash can be all digits or all letters, so git decides (containsCommit) and
  // ignores the ones it does not know.
  const commits = [...new Set([...text.matchAll(/\b[0-9a-f]{7,40}\b/g)].map((m) => m[0]))];
  return { prs: [...prs], commits, repos: [...repos] };
}

/**
 * Checks each item against `commit` in the repository at `dir` (`slug` is its owner/name, and
 * `projectRepos` the project's repositories). Evidence about another of the project's
 * repositories cannot be checked here, so it is unverified rather than out.
 */
export function checkRelease(dir: string, commit: string, slug: string | null, projectRepos: string[], items: ItemFields[]): ReleaseCheck[] {
  const merged = mergedPullRequests(dir, commit);
  const here = slug?.toLowerCase() ?? null;
  const others = new Set(projectRepos.map((r) => r.toLowerCase()).filter((r) => r !== here));
  const short = (hash: string) => hash.slice(0, 7);

  return items.map((fields) => {
    const id = fields.id;
    const refs = evidenceRefs(fields.evidence);
    const elsewhere = refs.repos.filter((r) => others.has(r));
    if (elsewhere.length && !(here && refs.repos.includes(here))) {
      return { id, verdict: 'unverified', detail: `the evidence is about ${elsewhere.join(', ')}` };
    }
    const known: string[] = [];
    for (const pr of refs.prs) {
      const hash = merged.get(pr);
      if (hash) return { id, verdict: 'in', detail: `PR #${pr} → ${short(hash)}` };
      known.push(`PR #${pr}`);
    }
    for (const hash of refs.commits) {
      const contained = containsCommit(dir, hash, commit);
      if (contained) return { id, verdict: 'in', detail: `commit ${short(hash)}` };
      if (contained === false) known.push(`commit ${short(hash)}`);
    }
    if (known.length) return { id, verdict: 'out', detail: `${known.join(', ')} not in this version` };
    return { id, verdict: 'unverified', detail: 'no PR or commit in the evidence' };
  });
}
