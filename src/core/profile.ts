import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ProfileSchema, type Profile } from './types.js';

export async function loadProfile(path: string): Promise<Profile> {
  const content = await readFile(path, 'utf-8');
  const data = parseYaml(content);
  const result = ProfileSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors
      .map(e => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid profile at ${path}:\n${errors}`);
  }

  return result.data;
}

export async function validateProfile(path: string): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    await loadProfile(path);
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, errors: [message] };
  }
}

export async function listProfiles(dir: string = './profiles'): Promise<string[]> {
  try {
    const files = await readdir(dir, { recursive: true });
    return files
      .filter(file => {
        const ext = extname(file);
        return ext === '.yaml' || ext === '.yml';
      })
      .map(file => join(dir, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export { ProfileSchema, type Profile };
