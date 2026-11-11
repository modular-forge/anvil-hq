// POST /api/git/push: the board's only way to reach the network. It pushes the data space's
// current branch to its upstream when the user presses Push, and nothing else: never with force,
// never on its own, and one push at a time. The CLI and Claude never push.

import { isRepository, pushToUpstream, type PushFailure } from '../git.ts';
import { gitStatus, type ApiResponse } from './api.ts';
import type { Body } from './writes.ts';

const STATUS: Record<PushFailure, number> = { 'no-upstream': 422, rejected: 409, failed: 502 };

export class Pusher {
  readonly dir: string;
  readonly timeout: number | undefined;
  #running = false;

  constructor(dir: string, timeout?: number) {
    this.dir = dir;
    this.timeout = timeout;
  }

  async push(body: Body, now: () => Date): Promise<ApiResponse> {
    if (Object.keys(body).length) return { status: 400, body: { error: `unexpected field(s): ${Object.keys(body).join(', ')}` } };
    if (!isRepository(this.dir)) return { status: 422, body: { error: 'the data space is not a git repository' } };
    if (this.#running) return { status: 409, body: { error: 'a push is already running' } };
    this.#running = true;
    try {
      const result = await pushToUpstream(this.dir, this.timeout);
      const git = gitStatus(this.dir, now()).body;
      if (!result.pushed) return { status: STATUS[result.failure], body: { error: result.message, failure: result.failure, git } };
      return { status: 200, body: { pushed: result.commits, git } };
    } finally {
      this.#running = false;
    }
  }
}
