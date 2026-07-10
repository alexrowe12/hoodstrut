import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import matter from 'gray-matter';
import { TaskSchema, type Task } from './types.js';

export interface TaskWithBody extends Task {
  body: string;
}

export async function loadTask(path: string): Promise<TaskWithBody> {
  const content = await readFile(path, 'utf-8');
  const { data, content: body } = matter(content);

  const result = TaskSchema.safeParse(data);

  if (!result.success) {
    const errors = result.error.errors
      .map(e => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid task at ${path}:\n${errors}`);
  }

  return {
    ...result.data,
    body: body.trim(),
  };
}

export async function validateTask(path: string): Promise<{ valid: boolean; errors?: string[] }> {
  try {
    await loadTask(path);
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, errors: [message] };
  }
}

export async function listTasks(dir: string = './tasks'): Promise<string[]> {
  try {
    const files = await readdir(dir, { recursive: true });
    return files
      .filter(file => extname(file) === '.md')
      .map(file => join(dir, file));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export { TaskSchema, type Task };
