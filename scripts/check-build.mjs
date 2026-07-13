import { access, readdir } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const required = [
  'cli/index.js',
  'docker/scripts/run-phase.mjs',
  'docker/scripts/run-sdk.mjs',
  'docker/scripts/run-task.sh',
  'docker/scripts/runtime-info.mjs',
  'docker/templates/Dockerfile.runner',
  'docker/templates/package.json',
  'docker/templates/package-lock.json',
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path));
    else paths.push(path);
  }
  return paths;
}

for (const path of required) {
  await access(resolve(dist, path));
}

const files = await walk(dist);
const stale = [];
for (const path of files) {
  const outputPath = relative(dist, path);
  if (!outputPath.endsWith('.js') || outputPath.startsWith('docker/scripts/')) continue;
  const sourcePath = resolve(root, 'src', outputPath.replace(/\.js$/, '.ts'));
  try {
    await access(sourcePath);
  } catch {
    stale.push(outputPath);
  }
}

if (stale.length > 0) {
  throw new Error(`Build contains JavaScript without a source module:\n${stale.join('\n')}`);
}

if (files.some((path) => path.includes('__tests__') || path.endsWith('.test.js'))) {
  throw new Error('Build contains test files');
}

console.log(`Build artifact check passed (${files.length} files).`);
