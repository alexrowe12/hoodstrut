import { readFile } from 'node:fs/promises';

export interface ScannedPrompt {
  content: string;
  sourcePath: string;
}

export async function scanPrompt(paths: string[]): Promise<ScannedPrompt | null> {
  for (const path of paths) {
    try {
      return { content: (await readFile(path, 'utf-8')).trim(), sourcePath: path };
    } catch {
      // Try the next valid prompt location for this scope.
    }
  }
  return null;
}
