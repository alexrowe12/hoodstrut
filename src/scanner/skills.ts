import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import matter from 'gray-matter';

export interface ScannedSkill {
  name: string;
  description?: string;
  sourcePath: string;
}

async function parseSkillFile(skillPath: string): Promise<ScannedSkill | null> {
  try {
    const content = await readFile(skillPath, 'utf-8');
    const { data } = matter(content);

    const name = typeof data.name === 'string' ? data.name : undefined;
    if (!name) return null;

    return {
      name,
      description: typeof data.description === 'string' ? data.description : undefined,
      sourcePath: skillPath,
    };
  } catch {
    return null;
  }
}

export async function scanSkills(): Promise<ScannedSkill[]> {
  const skillsDir = join(homedir(), '.claude', 'skills');
  const skills: ScannedSkill[] = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
      const skill = await parseSkillFile(skillMdPath);

      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // Skills directory doesn't exist or isn't readable
  }

  return skills;
}
