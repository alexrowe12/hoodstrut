import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type { GeneratedProfile } from './profile-generator.js';
import { serializeGeneratedProfile } from './profile-generator.js';
import { ProfileSchema } from '../core/types.js';

export async function writeGeneratedProfile(
  generated: GeneratedProfile,
  outputDir: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  const profile = ProfileSchema.parse(generated.profile);
  const fileName = profile.name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!fileName) throw new Error(`Profile name cannot produce a safe filename: ${profile.name}`);
  const assetsDir = join(outputDir, `${fileName}.assets`, 'skills');
  for (const skill of profile.skills ?? []) {
    const destination = join(assetsDir, skill.name);
    await mkdir(destination, { recursive: true });
    await cp(skill.source, destination, { recursive: true });
    skill.source = relative(outputDir, destination);
  }

  const outputPath = join(outputDir, `${fileName}.yaml`);
  await writeFile(
    outputPath,
    serializeGeneratedProfile(profile, profile.source_path ?? 'unknown'),
    'utf-8'
  );
  return outputPath;
}
