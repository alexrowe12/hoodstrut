import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Loads KEY=VALUE pairs from a `.env` file in `dir` into `process.env`.
 *
 * This is what lets users keep their key in `.env` instead of running
 * `set -a && source .env && set +a` before every command: a process can set
 * its own environment variables, even though it can't push them back to the
 * parent shell.
 *
 * Real environment variables always win — a value already present in
 * `process.env` is never overwritten by the file. Returns the list of keys
 * that were actually loaded (i.e. weren't already set), for optional logging.
 */
export function loadDotenv(dir: string = process.cwd()): string[] {
  const path = resolve(dir, '.env');
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    // No .env (or unreadable) — nothing to load, not an error.
    return [];
  }

  const loaded: string[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    let key = line.slice(0, eq).trim();
    // Tolerate `export KEY=value`, which some users add out of habit.
    if (key.startsWith('export ')) {
      key = key.slice('export '.length).trim();
    }
    if (!key) {
      continue;
    }
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of surrounding quotes.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}
