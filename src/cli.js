// Argument parsing and command dispatch. Commands return an exit code; nothing here calls
// process.exit, so main() can be tested in-process.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DataDirError, TOOL_ROOT, resolveDataDir } from './data-dir.js';
import { validateSpace } from './validate.js';

const USAGE = `Usage: anvil <command> [options]

Commands:
  validate     Check the whole data space against the format rules

Global options:
  --data <path>  Data space to use (default: ANVIL_DATA, user config, or search upwards)
  --json         Machine-readable output
  -h, --help     Show this help
  -v, --version  Show the version
`;

const GLOBAL_OPTIONS = {
  data: { type: 'string' },
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

const COMMANDS = {
  validate: { options: {}, run: runValidate },
};

/** Runs the CLI with `argv` (without node and script) and returns the exit code. */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr, env = process.env, cwd = process.cwd() } = {}) {
  const io = { stdout, stderr, env, cwd };
  // First, a lenient pass to find the command, so global options may come before it.
  const commandName = parseArgs({ args: argv, options: GLOBAL_OPTIONS, allowPositionals: true, strict: false }).positionals[0];
  const command = Object.hasOwn(COMMANDS, commandName) ? COMMANDS[commandName] : undefined;

  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: { ...GLOBAL_OPTIONS, ...command?.options }, allowPositionals: true, strict: true });
  } catch (error) {
    stderr.write(`anvil: ${error.message}\n`);
    return 2;
  }
  const { values, positionals } = parsed;

  if (values.version) {
    stdout.write(`${readVersion()}\n`);
    return 0;
  }
  if (values.help || !commandName) {
    (commandName || values.help ? stdout : stderr).write(USAGE);
    return values.help ? 0 : 2;
  }
  if (!command) {
    stderr.write(`anvil: unknown command "${commandName}"\n\n${USAGE}`);
    return 2;
  }

  try {
    return await command.run({ values, args: positionals.slice(1), io });
  } catch (error) {
    if (error instanceof DataDirError) {
      stderr.write(`anvil: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
}

function runValidate({ values, io }) {
  const { dir } = resolveDataDir({ flag: values.data, env: io.env, cwd: io.cwd });
  const { errors, stats } = validateSpace(dir);
  if (values.json) {
    io.stdout.write(`${JSON.stringify({ ok: errors.length === 0, errors, stats }, null, 2)}\n`);
  } else if (errors.length === 0) {
    io.stdout.write(`OK: ${stats.projects} project(s), ${stats.items} item(s) in ${dir}\n`);
  } else {
    for (const { file, message } of errors) io.stdout.write(`${file}: ${message}\n`);
    const files = new Set(errors.map((e) => e.file)).size;
    io.stdout.write(`\n${errors.length} problem(s) in ${files} file(s)\n`);
  }
  return errors.length === 0 ? 0 : 1;
}

function readVersion() {
  return JSON.parse(readFileSync(join(TOOL_ROOT, 'package.json'), 'utf8')).version;
}
