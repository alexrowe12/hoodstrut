import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ScannedPrompt {
  content: string;
  sourcePath: string;
}

export async function scanPrompt(projectPath: string): Promise<ScannedPrompt | null> {
  const claudeMdPath = join(projectPath, 'CLAUDE.md');

  try {
    const content = await readFile(claudeMdPath, 'utf-8');
    return {
      content: content.trim(),
      sourcePath: claudeMdPath,
    };
  } catch {
    return null;
  }
}
