import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import matter from 'gray-matter';

export interface ScannedSkill {
  name: string;
  description?: string;
  sourcePath: string;
}

async function parseSkill(skillDir: string): Promise<ScannedSkill | null> {
  const skillPath = join(skillDir, 'SKILL.md');
  try {
    const { data } = matter(await readFile(skillPath, 'utf-8'));
    if (typeof data.name !== 'string' || !data.name) return null;
    return {
      name: data.name,
      description: typeof data.description === 'string' ? data.description : undefined,
      sourcePath: skillDir,
    };
  } catch {
    return null;
  }
}

export async function scanSkills(skillsDir: string): Promise<ScannedSkill[]> {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills = await Promise.all(entries
      .filter(entry => entry.isDirectory())
      .map(entry => parseSkill(join(skillsDir, entry.name))));
    return skills.filter((skill): skill is ScannedSkill => skill !== null);
  } catch {
    return [];
  }
}
