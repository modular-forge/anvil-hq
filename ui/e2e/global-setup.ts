// Starts `anvil serve` over a fresh git copy of examples/ and shares its URL with the tests.
// The returned function stops it and deletes the copy.

import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

export default async function globalSetup(): Promise<() => void> {
  const dir = mkdtempSync(join(tmpdir(), 'anvil-e2e-'));
  cpSync(join(ROOT, 'examples'), dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.email', 'e2e@example.com');
  git('config', 'user.name', 'E2E');
  git('config', 'core.autocrlf', 'false');
  git('add', '--all');
  git('commit', '--quiet', '-m', 'initial');

  const server = spawn(process.execPath, [join(ROOT, 'bin', 'anvil.ts'), 'serve', '--json', '--data', dir], { stdio: ['ignore', 'pipe', 'inherit'] });
  const url = await new Promise<string>((done, fail) => {
    let out = '';
    const timer = setTimeout(() => fail(new Error(`anvil serve did not start:\n${out}`)), 15_000);
    server.stdout.setEncoding('utf8');
    server.stdout.on('data', (chunk: string) => {
      out += chunk;
      try {
        const { url: printed } = JSON.parse(out) as { url: string };
        clearTimeout(timer);
        done(printed);
      } catch {
        // Not the whole JSON yet.
      }
    });
    server.on('exit', (code) => fail(new Error(`anvil serve exited with ${code}:\n${out}`)));
  });

  process.env['ANVIL_E2E_URL'] = url;
  process.env['ANVIL_E2E_DATA'] = dir;
  return () => {
    server.kill();
    rmSync(dir, { recursive: true, force: true });
  };
}
