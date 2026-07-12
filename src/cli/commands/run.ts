import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadProfile } from '../../core/profile.js';
import { loadTask } from '../../core/task.js';
import { buildRunnerImage } from '../../docker/index.js';
import { executeRun, resolveProfilePath, resolveTaskPath } from '../../core/run-pipeline.js';
import { loadDotenv } from '../../core/dotenv.js';
import { generateReport } from './report.js';
import type { TelemetryConfig } from '../../metrics/types.js';

function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
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
      // Pull the key (and anything else) from a local .env so users don't have
      // to `set -a && source .env && set +a` themselves.
      loadDotenv();

      if (!process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable is required'));
        console.error(
          chalk.dim('  Set it in the environment, or add it to a .env file in this directory')
        );
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

      const { runResult, duration } = await executeRun({
        profile,
        task,
        runId,
        outputDir,
        verbose: options.verbose,
        timeout: options.timeout,
        telemetry,
      });

      console.log('');
      console.log(chalk.bold('=== Execution Complete ==='));
      console.log('');

      const status = runResult.result.status ?? (runResult.result.success ? 'passed' : 'failed');
      if (status === 'passed') {
        console.log(chalk.green(`✓ Success`));
      } else if (status === 'timed_out') {
        console.log(chalk.red('✗ Timed out'));
      } else if (status.endsWith('_error')) {
        console.log(chalk.yellow(`⚠ Error: ${status}`));
      } else {
        console.log(chalk.red(`✗ Failed (exit code: ${runResult.result.exit_code})`));
      }

      console.log(chalk.gray(`Duration: ${duration}s`));
      console.log(chalk.gray(`Success method: ${runResult.result.success_method}`));
      if (runResult.result.success_details) {
        console.log(chalk.gray(`Details: ${runResult.result.success_details}`));
      }

      console.log('');
      if (runResult.metrics) {
        const m = runResult.metrics;
        console.log(chalk.bold('=== Metrics ==='));
        console.log(chalk.cyan(`Model: ${m.model}`));
        console.log(chalk.cyan(`Tokens: ${m.tokens.total_tokens.toLocaleString()} (${m.tokens.input_tokens.toLocaleString()} in / ${m.tokens.output_tokens.toLocaleString()} out)`));
        if (m.tokens.cache_read_tokens > 0 || m.tokens.cache_write_tokens > 0) {
          console.log(chalk.cyan(`Cache: ${m.tokens.cache_read_tokens.toLocaleString()} read / ${m.tokens.cache_write_tokens.toLocaleString()} write`));
        }
        console.log(chalk.cyan(`Cost: $${m.cost_usd.toFixed(4)}`));
        console.log(chalk.cyan(`Turns: ${m.turns}`));
      } else {
        console.log(chalk.bgYellow.black(' ⚠️  WARNING: METRICS EXTRACTION FAILED '));
        console.log('');
        for (const warning of runResult.warnings ?? []) {
          console.log(chalk.yellow(`  • ${warning}`));
        }
        console.log('');
        console.log(chalk.yellow('Token counts, cost, and scoring will not be available.'));
        console.log(chalk.yellow('This may indicate an issue with the Agent SDK or container setup.'));
      }

      const { files_created, files_modified, files_deleted } = runResult.result;

      if (files_created.length > 0) {
        console.log(chalk.green(`Files created: ${files_created.length}`));
        for (const file of files_created.slice(0, 5)) {
          console.log(chalk.gray(`  + ${file}`));
        }
        if (files_created.length > 5) {
          console.log(chalk.gray(`  ... and ${files_created.length - 5} more`));
        }
      }

      if (files_modified.length > 0) {
        console.log(chalk.yellow(`Files modified: ${files_modified.length}`));
        for (const file of files_modified.slice(0, 5)) {
          console.log(chalk.gray(`  ~ ${file}`));
        }
        if (files_modified.length > 5) {
          console.log(chalk.gray(`  ... and ${files_modified.length - 5} more`));
        }
      }

      if (files_deleted.length > 0) {
        console.log(chalk.red(`Files deleted: ${files_deleted.length}`));
        for (const file of files_deleted.slice(0, 5)) {
          console.log(chalk.gray(`  - ${file}`));
        }
      }

      console.log('');
      console.log(chalk.gray(`Logs: ${outputDir}`));

      const score = runResult.score;
      if (score) {
        console.log('');
        console.log(chalk.bold('=== Score ==='));
        console.log(chalk.cyan(`Score: ${score.value.toLocaleString()}`));
        console.log(chalk.gray(`  Success: ${score.breakdown.success_bonus} pts`));
        console.log(chalk.gray(`  Cost efficiency: ${score.breakdown.cost_score.toFixed(0)} pts (${formatCost(score.breakdown.actual_cost)} vs ${formatCost(score.breakdown.expected_cost)} expected)`));
        console.log(chalk.gray(`  Time efficiency: ${score.breakdown.time_score.toFixed(0)} pts (${score.breakdown.actual_time}s vs ${score.breakdown.expected_time}s expected)`));
        console.log(chalk.gray(`  Difficulty: ${score.breakdown.difficulty_multiplier}x`));
      }

      const resultsDir = dirname(outputDir);
      try {
        const reportPath = await generateReport(resultsDir);
        console.log('');
        console.log(chalk.gray(`Report updated: ${reportPath}`));
      } catch {
        // Report generation is best-effort
      }

      process.exit(runResult.result.success ? 0 : 1);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });
