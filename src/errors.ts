// Errors shown to the user as a single line. The CLI maps them to exit codes.

/** A rule or state prevents the operation (exit code 1). */
export class AnvilError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnvilError';
  }
}

/** The command line is wrong (exit code 2). */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** A file changed on disk since it was read (exit code 1). */
export class ConflictError extends AnvilError {
  constructor(file: string) {
    super(`${file} changed on disk while anvil was working on it; nothing was written. Run the command again.`);
    this.name = 'ConflictError';
  }
}
