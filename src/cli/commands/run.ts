import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, extname } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { loadProfile } from '../../core/profile.js';
import { loadTask } from '../../core/task.js';
import { runContainer, buildRunnerImage } from '../../docker/index.js';
import type { TelemetryConfig } from '../../metrics/types.js';

function resolveProfilePath(nameOrPath: string): string {
  if (extname(nameOrPath) === '.yaml' || extname(nameOrPath) === '.yml') {
    return resolve(nameOrPath);
  }
  return resolve('./profiles', `${nameOrPath}.yaml`);
}

function resolveTaskPath(idOrPath: string): string {
  if (extname(idOrPath) === '.md') {
    return resolve(idOrPath);
  }
  return resolve('./tasks', `${idOrPath}.md`);
}

export const runCommand = new Command('run')
  .description('Execute a single profile against a single task')
  .requiredOption('-p, --profile <profile>', 'Profile name or path')
  .requiredOption('-t, --task <task>', 'Task ID or path')
  .option('-o, --output <directory>', 'Output directory for results')
  .option('-v, --verbose', 'Show detailed output')
  .option('--timeout <seconds>', 'Override timeout in seconds', parseInt)
  .option('--build', 'Force rebuild of Docker image')
  .option('--telemetry <endpoint>', 'Export OTEL telemetry to endpoint (e.g., http://localhost:4318)')
  .option('--telemetry-headers <headers>', 'OTEL headers (e.g., "Authorization=Bearer token")')
  .action(async (options) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable is required'));
        process.exit(1);
      }

      const profilePath = resolveProfilePath(options.profile);
      const taskPath = resolveTaskPath(options.task);

      console.log(chalk.blue('Loading profile and task...'));

      const [profile, task] = await Promise.all([
        loadProfile(profilePath),
        loadTask(taskPath),
      ]);

      console.log(chalk.blue(`Profile: ${profile.name}`));
      console.log(chalk.blue(`Task: ${task.id} - ${task.title}`));

      const runId = `run-${Date.now()}`;
      const outputDir = options.output || resolve('./results', runId);

      await mkdir(outputDir, { recursive: true });

      if (options.build) {
        console.log(chalk.blue('Building Docker image...'));
        await buildRunnerImage(true);
      }

      // Build telemetry config if endpoint provided
      let telemetry: TelemetryConfig | undefined;
      if (options.telemetry) {
        telemetry = {
          endpoint: options.telemetry,
          headers: options.telemetryHeaders,
        };
        console.log(chalk.blue(`Telemetry: exporting to ${options.telemetry}`));
      }

      console.log(chalk.blue('Starting execution in Docker container...'));
      console.log(chalk.gray(`Output directory: ${outputDir}`));

      const result = await runContainer({
        profile,
        task,
        outputDir,
        verbose: options.verbose,
        timeout: options.timeout,
        telemetry,
      });

      console.log('');
      console.log(chalk.bold('=== Execution Complete ==='));
      console.log('');

      if (result.success) {
        console.log(chalk.green(`✓ Success`));
      } else {
        console.log(chalk.red(`✗ Failed (exit code: ${result.exitCode})`));
      }

      console.log(chalk.gray(`Duration: ${result.duration}s`));
      console.log(chalk.gray(`Success method: ${result.successMethod}`));

      // Display metrics or warning
      console.log('');
      if (result.metrics.success) {
        const m = result.metrics.metrics;
        console.log(chalk.bold('=== Metrics ==='));
        console.log(chalk.cyan(`Model: ${m.model}`));
        console.log(chalk.cyan(`Tokens: ${m.tokens.total_tokens.toLocaleString()} (${m.tokens.input_tokens.toLocaleString()} in / ${m.tokens.output_tokens.toLocaleString()} out)`));
        if (m.tokens.cache_read_tokens > 0 || m.tokens.cache_write_tokens > 0) {
          console.log(chalk.cyan(`Cache: ${m.tokens.cache_read_tokens.toLocaleString()} read / ${m.tokens.cache_write_tokens.toLocaleString()} write`));
        }
        console.log(chalk.cyan(`Cost: $${m.cost_usd.toFixed(4)}`));
        console.log(chalk.cyan(`Turns: ${m.turns}`));
      } else {
        // LOUD WARNING - metrics are the whole point!
        console.log(chalk.bgYellow.black(' ⚠️  WARNING: METRICS EXTRACTION FAILED '));
        console.log('');
        for (const warning of result.metrics.warnings) {
          console.log(chalk.yellow(`  • ${warning}`));
        }
        console.log('');
        console.log(chalk.yellow('Token counts, cost, and scoring will not be available.'));
        console.log(chalk.yellow('This may indicate an issue with the Agent SDK or container setup.'));
      }

      if (result.filesChanged.created.length > 0) {
        console.log(chalk.green(`Files created: ${result.filesChanged.created.length}`));
        for (const file of result.filesChanged.created.slice(0, 5)) {
          console.log(chalk.gray(`  + ${file}`));
        }
        if (result.filesChanged.created.length > 5) {
          console.log(chalk.gray(`  ... and ${result.filesChanged.created.length - 5} more`));
        }
      }

      if (result.filesChanged.modified.length > 0) {
        console.log(chalk.yellow(`Files modified: ${result.filesChanged.modified.length}`));
        for (const file of result.filesChanged.modified.slice(0, 5)) {
          console.log(chalk.gray(`  ~ ${file}`));
        }
        if (result.filesChanged.modified.length > 5) {
          console.log(chalk.gray(`  ... and ${result.filesChanged.modified.length - 5} more`));
        }
      }

      if (result.filesChanged.deleted.length > 0) {
        console.log(chalk.red(`Files deleted: ${result.filesChanged.deleted.length}`));
        for (const file of result.filesChanged.deleted.slice(0, 5)) {
          console.log(chalk.gray(`  - ${file}`));
        }
      }

      console.log('');
      console.log(chalk.gray(`Logs: ${outputDir}`));

      const summary = {
        id: runId,
        timestamp: new Date().toISOString(),
        profile: {
          name: profile.name,
          model: profile.model,
          effort: profile.effort,
        },
        task: {
          id: task.id,
          title: task.title,
          difficulty: task.difficulty,
        },
        result: {
          success: result.success,
          successMethod: result.successMethod,
          exitCode: result.exitCode,
          duration: result.duration,
          filesChanged: result.filesChanged,
        },
        metrics: result.metrics.success ? result.metrics.metrics : null,
        metrics_warnings: result.metrics.success ? [] : result.metrics.warnings,
        logs: {
          stdout: result.stdout,
          stderr: result.stderr,
        },
      };

      await writeFile(
        resolve(outputDir, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf-8'
      );

      process.exit(result.success ? 0 : 1);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });
