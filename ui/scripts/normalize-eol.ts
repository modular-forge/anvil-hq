// Runs after `ng build`: rewrites CRLF line endings in the built text files as LF.
//
// The build copies third-party licence texts into 3rdpartylicenses.txt as they ship, and some
// use CRLF. The repository stores text with LF (.gitattributes), and a working file with CRLF
// shows as modified to `git status` in a fresh clone even though `git diff` is empty, which made
// CI's "ui-dist/ matches the sources" check fail. With LF bytes everywhere, the build is the same
// on every system and git has nothing to convert.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const TEXT = new Set(['.html', '.js', '.css', '.txt', '.svg', '.json']);
const root = resolve(import.meta.dirname, '..', '..', 'ui-dist');

let changed = 0;
for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !TEXT.has(extname(entry.name))) continue;
  const file = join(entry.parentPath, entry.name);
  const text = readFileSync(file, 'utf8');
  if (!text.includes('\r\n')) continue;
  writeFileSync(file, text.replaceAll('\r\n', '\n'));
  changed++;
}
console.log(`normalize-eol: ${changed} file(s) rewritten with LF line endings`);
