import { Command } from 'commander';
import chalk from 'chalk';
import { mkdir, writeFile, cp, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/cli/commands/init.js -> package root is three levels up. This resolves
// both from a git checkout (`node dist/...`) and an installed package.
const PACKAGE_ROOT = resolve(__dirname, '../../../');

// Directories every hoodstrut project needs.
const SCAFFOLD_DIRS = ['profiles', 'tasks', 'benchmarks', 'results'];

// Bundled example content: [source relative to package root, dest relative to cwd].
const EXAMPLE_PATHS: Array<[string, string]> = [
  ['profiles/examples', 'profiles/examples'],
  ['tasks/examples', 'tasks/examples'],
  ['tasks/smoke', 'tasks/smoke'],
  ['repos/todo-app', 'repos/todo-app'],
  ['benchmarks/example-suite.yaml', 'benchmarks/example-suite.yaml'],
];

const ENV_EXAMPLE = `# Copy this file to .env and fill in your key.
#
# hoodstrut loads .env from the current directory automatically, so this is all
# the setup you need — no \`source\`/\`export\` required. A real environment
# variable of the same name still takes precedence over this file.
ANTHROPIC_API_KEY=
`;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Interactively ask for the API key. Returns the trimmed key, or null when
 * skipped or when stdin isn't a terminal (so CI / piped invocations never hang).
 */
async function promptApiKey(): Promise<string | null> {
  if (!process.stdin.isTTY) {
    return null;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      'Enter your ANTHROPIC_API_KEY (leave blank to skip): '
    );
    return answer.trim() || null;
  } finally {
    rl.close();
  }
}

export const initCommand = new Command('init')
  .description('Initialize a new hoodstrut setup in the current directory')
  .option('--with-examples', 'Also copy example profiles, tasks, and the todo-app repo')
  .action(async (options: { withExamples?: boolean }) => {
    const cwd = process.cwd();
    const created: string[] = [];
    const skipped: string[] = [];

    // 1. Scaffold directories with a .gitkeep so they survive in git.
    for (const dir of SCAFFOLD_DIRS) {
      const dirPath = join(cwd, dir);
      await mkdir(dirPath, { recursive: true });
      const keep = join(dirPath, '.gitkeep');
      if (await exists(keep)) {
        skipped.push(`${dir}/.gitkeep`);
      } else {
        await writeFile(keep, '');
        created.push(`${dir}/`);
      }
    }

    // 2. .env.example (never clobber an existing one).
    const envExamplePath = join(cwd, '.env.example');
    if (await exists(envExamplePath)) {
      skipped.push('.env.example');
    } else {
      await writeFile(envExamplePath, ENV_EXAMPLE);
      created.push('.env.example');
    }

    // 2b. Offer to capture the key straight into a real .env. hoodstrut loads
    // .env itself at run time, so this is all the setup a user needs — no
    // `set -a && source .env && set +a` dance required.
    const dotenvPath = join(cwd, '.env');
    let dotenvReady = await exists(dotenvPath);
    if (dotenvReady) {
      skipped.push('.env');
    } else {
      const key = await promptApiKey();
      if (key) {
        await writeFile(dotenvPath, `ANTHROPIC_API_KEY=${key}\n`);
        created.push('.env');
        dotenvReady = true;
      }
    }

    // 3. Example content.
    if (options.withExamples) {
      for (const [srcRel, destRel] of EXAMPLE_PATHS) {
        const src = join(PACKAGE_ROOT, srcRel);
        if (!(await exists(src))) {
          console.error(
            chalk.red(
              `Bundled example not found: ${src}\n` +
                'The package may be built or published incorrectly (check the "files" field).'
            )
          );
          process.exitCode = 1;
          return;
        }
        const dest = join(cwd, destRel);
        if (resolve(src) === resolve(dest)) {
          // Running init inside the package/repo itself — nothing to copy.
          skipped.push(destRel);
          continue;
        }
        const destExisted = await exists(dest);
        // force:false + errorOnExist:false => copy new files, skip existing ones.
        await cp(src, dest, { recursive: true, force: false, errorOnExist: false });
        (destExisted ? skipped : created).push(`${destRel}${destRel.endsWith('.yaml') ? '' : '/'}`);
      }
    }

    // Summary.
    console.log(chalk.bold('\nhoodstrut init complete\n'));
    if (created.length) {
      console.log(chalk.green('Created:'));
      for (const c of created) console.log(`  + ${c}`);
    }
    if (skipped.length) {
      console.log(chalk.yellow('\nSkipped (already existed):'));
      for (const s of skipped) console.log(`  - ${s}`);
    }

    console.log(chalk.dim('\nNext steps:'));
    // hoodstrut auto-loads .env, so the only prerequisite is that the key
    // exists there. Only nudge the user about it when it isn't set up yet.
    let step = 1;
    if (!dotenvReady) {
      console.log(
        chalk.dim(`  ${step++}. cp .env.example .env  &&  add your ANTHROPIC_API_KEY`)
      );
    }
    if (options.withExamples) {
      console.log(
        chalk.dim(
          `  ${step++}. hoodstrut run --profile profiles/examples/default.yaml --task tasks/examples/fix-todo-persistence.md`
        )
      );
    } else {
      console.log(chalk.dim(`  ${step++}. hoodstrut init --with-examples   # to add runnable examples`));
    }
  });
