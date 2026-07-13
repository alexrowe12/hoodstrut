import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parse as parseYaml } from 'yaml';

const runFile = promisify(execFile);
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const workspace = await mkdtemp(join(tmpdir(), 'hoodstrut-package-'));
const packDirectory = join(workspace, 'pack');
const installDirectory = join(workspace, 'install');
const projectDirectory = join(workspace, 'quickstart');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run(command, args, options = {}) {
  try {
    return await runFile(command, args, {
      maxBuffer: 20 * 1024 * 1024,
      ...options,
    });
  } catch (error) {
    const stdout = error.stdout ? `\nstdout:\n${error.stdout}` : '';
    const stderr = error.stderr ? `\nstderr:\n${error.stderr}` : '';
    throw new Error(`${command} ${args.join(' ')} failed${stdout}${stderr}`, { cause: error });
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function buildManifest(directory, prefix = '') {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true });
  const manifest = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = join(prefix, entry.name);
    if (entry.isDirectory()) {
      manifest.push(...await buildManifest(directory, relativePath));
    } else {
      const contents = await readFile(join(directory, relativePath));
      manifest.push(`${relativePath}:${createHash('sha256').update(contents).digest('hex')}`);
    }
  }
  return manifest;
}

try {
  await mkdir(packDirectory);
  await mkdir(installDirectory);
  await mkdir(projectDirectory);

  await mkdir(join(root, 'dist'), { recursive: true });
  await writeFile(join(root, 'dist', 'stale-release-sentinel'), 'must be removed\n');
  await run(npm, ['run', 'build'], { cwd: root });
  assert(!await exists(join(root, 'dist', 'stale-release-sentinel')), 'Build did not clean dist');
  await run(npm, ['run', 'check:build'], { cwd: root });
  const firstBuild = await buildManifest(join(root, 'dist'));
  await run(npm, ['run', 'build'], { cwd: root });
  const secondBuild = await buildManifest(join(root, 'dist'));
  assert(
    JSON.stringify(secondBuild) === JSON.stringify(firstBuild),
    'Consecutive clean builds produced different artifacts'
  );

  const packed = await run(npm, [
    'pack',
    '--ignore-scripts',
    '--json',
    '--pack-destination',
    packDirectory,
  ], { cwd: root });
  const packResults = JSON.parse(packed.stdout);
  assert(Array.isArray(packResults) && packResults.length === 1, 'npm pack returned no package');

  const packResult = packResults[0];
  const paths = new Set(packResult.files.map((file) => file.path));
  const required = [
    'package.json',
    'README.md',
    'LICENSE',
    'CONTRIBUTING.md',
    'SECURITY.md',
    'ROADMAP.md',
    'dist/cli/index.js',
    'dist/docker/templates/Dockerfile.runner',
    'dist/docker/templates/package.json',
    'dist/docker/templates/package-lock.json',
    'dist/docker/scripts/run-sdk.mjs',
    'dist/docker/scripts/runtime-info.mjs',
    'profiles/examples/default.yaml',
    'tasks/examples/fix-todo-persistence.md',
    'repos/todo-app/package.json',
    'repos/todo-app/test/persistence.test.js',
    'benchmarks/example-suite.yaml',
  ];

  for (const path of required) {
    assert(paths.has(path), `Packed package is missing ${path}`);
  }

  const forbidden = [
    /^\.claude\//,
    /^results\//,
    /^otel_logs\//,
    /^src\//,
    /(?:^|\/)\.env(?:\.|$)/,
    /__tests__/,
    /^dist\/.*\.test\.[cm]?[jt]s$/,
    /^dist\/core\/scorer\./,
    /^dist\/docker\/sdk-runner\./,
  ];
  for (const path of paths) {
    assert(!forbidden.some((pattern) => pattern.test(path)), `Packed forbidden file ${path}`);
  }

  const binEntry = packResult.files.find((file) => file.path === 'dist/cli/index.js');
  assert(binEntry?.mode === 0o755, 'Packed CLI entry is not executable');

  const tarball = join(packDirectory, basename(packResult.filename));
  await writeFile(join(installDirectory, 'package.json'), '{"private":true}\n');
  await run(npm, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    tarball,
  ], { cwd: installDirectory });

  const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8'));
  const bin = join(
    installDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'hoodstrut.cmd' : 'hoodstrut'
  );
  const version = await run(bin, ['--version'], { cwd: projectDirectory });
  assert(version.stdout.trim() === packageJson.version, 'Installed CLI reports the wrong version');

  const help = await run(bin, ['--help'], { cwd: projectDirectory });
  for (const command of ['init', 'profile', 'task', 'run', 'benchmark', 'report']) {
    assert(help.stdout.includes(command), `Installed CLI help is missing ${command}`);
  }

  await writeFile(join(projectDirectory, '.gitignore'), 'custom-cache/\n');
  await mkdir(join(projectDirectory, '.github', 'workflows'), { recursive: true });
  await writeFile(join(projectDirectory, '.github', 'workflows', 'user.yml'), 'name: user\n');
  await writeFile(join(projectDirectory, 'USER_FILE.md'), 'preserve me\n');

  await run(bin, ['init', '--with-examples'], { cwd: projectDirectory });
  assert(!await exists(join(projectDirectory, '.env')), 'Noninteractive init created a real .env');

  const gitignoreAfterFirstInit = await readFile(join(projectDirectory, '.gitignore'), 'utf-8');
  assert(gitignoreAfterFirstInit.startsWith('custom-cache/\n'), 'Init replaced .gitignore');
  for (const rule of ['.env', '!.env.example', 'results/', 'otel_logs/']) {
    assert(gitignoreAfterFirstInit.includes(rule), `.gitignore is missing ${rule}`);
  }

  const configPath = join(projectDirectory, 'benchmarks', 'example-suite.yaml');
  const config = parseYaml(await readFile(configPath, 'utf-8'));
  for (const profile of config.profiles) {
    assert(await exists(join(projectDirectory, profile)), `Benchmark profile is missing: ${profile}`);
    await run(bin, ['profile', 'validate', profile], { cwd: projectDirectory });
  }
  for (const task of config.tasks) {
    assert(await exists(join(projectDirectory, task)), `Benchmark task is missing: ${task}`);
    await run(bin, ['task', 'validate', task], { cwd: projectDirectory });
  }

  await run(bin, ['init', '--with-examples'], { cwd: projectDirectory });
  assert(
    await readFile(join(projectDirectory, '.gitignore'), 'utf-8') === gitignoreAfterFirstInit,
    'Repeated init changed an already-configured .gitignore'
  );
  assert(
    await readFile(join(projectDirectory, '.github', 'workflows', 'user.yml'), 'utf-8') === 'name: user\n',
    'Init changed an existing .github file'
  );
  assert(
    await readFile(join(projectDirectory, 'USER_FILE.md'), 'utf-8') === 'preserve me\n',
    'Init changed an unrelated user file'
  );

  console.log(`Package install and offline quickstart passed for ${packResult.filename}.`);
} finally {
  await rm(workspace, { recursive: true, force: true });
}
