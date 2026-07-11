import { Command } from 'commander';
import chalk from 'chalk';
import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { BenchmarkConfigSchema, type BenchmarkConfig } from '../../core/types.js';
import { loadBenchmarkConfig, runBenchmark } from '../../core/benchmark.js';
import { listTasks } from '../../core/task.js';
import { generateReport } from './report.js';
import { formatCost, formatDuration } from '../../output/markdown.js';
import type { TelemetryConfig } from '../../metrics/types.js';

/** Top-level ./profiles/*.yaml only — examples/ subdirectory is opt-in by path. */
async function discoverProfiles(): Promise<string[]> {
  try {
    const entries = await readdir('./profiles', { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && (extname(e.name) === '.yaml' || extname(e.name) === '.yml'))
      .map(e => join('./profiles', e.name));
  } catch {
    return [];
  }
}

function parseList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  const items = value.split(',').map(s => s.trim()).filter(s => s.length > 0);
  return items.length > 0 ? items : undefined;
}

export const benchmarkCommand = new Command('benchmark')
  .description('Run multiple profiles against multiple tasks')
  .option('-p, --profiles <list>', 'Comma-separated profile names or paths')
  .option('-t, --tasks <list>', 'Comma-separated task IDs or paths')
  .option('-c, --config <file>', 'Benchmark YAML config file')
  .option('--parallel <count>', 'Number of concurrent runs', parseInt)
  .option('--name <name>', 'Benchmark name')
  .option('--timeout <seconds>', 'Per-run timeout override in seconds', parseInt)
  .option('--telemetry <endpoint>', 'Export OTEL telemetry to endpoint (e.g., http://localhost:4318)')
  .option('--telemetry-headers <headers>', 'OTEL headers (e.g., "Authorization=Bearer token")')
  .action(async (options) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error(chalk.red('Error: ANTHROPIC_API_KEY environment variable is required'));
        process.exit(1);
      }

      const fileConfig = options.config
        ? await loadBenchmarkConfig(options.config)
        : undefined;

      // Precedence: CLI flag > config file > discovery/defaults
      let profiles = parseList(options.profiles) ?? fileConfig?.profiles;
      let tasks = parseList(options.tasks) ?? fileConfig?.tasks;

      if (!profiles) {
        profiles = await discoverProfiles();
        if (profiles.length === 0) {
          console.error(chalk.red('Error: no profiles specified and none found in ./profiles'));
          process.exit(1);
        }
      }

      if (!tasks) {
        tasks = await listTasks('./tasks');
        if (tasks.length === 0) {
          console.error(chalk.red('Error: no tasks specified and none found in ./tasks'));
          process.exit(1);
        }
      }

      const config: BenchmarkConfig = BenchmarkConfigSchema.parse({
        name: options.name ?? fileConfig?.name,
        profiles,
        tasks,
        parallel: options.parallel ?? fileConfig?.parallel,
        timeout: options.timeout ?? fileConfig?.timeout,
        output: fileConfig?.output,
      });

      let telemetry: TelemetryConfig | undefined;
      if (options.telemetry) {
        telemetry = {
          endpoint: options.telemetry,
          headers: options.telemetryHeaders,
        };
        console.log(chalk.blue(`Telemetry: exporting to ${options.telemetry}`));
      }

      const totalRuns = config.profiles.length * config.tasks.length;
      console.log(chalk.bold(`Benchmark: ${config.name} (${config.profiles.length} profile(s) × ${config.tasks.length} task(s) = ${totalRuns} runs, parallel: ${config.parallel})`));
      console.log('');

      const { summary, benchmarkDir } = await runBenchmark(config, {
        telemetry,
        onProgress: (progress) => {
          const label = `${progress.spec.profile.name} × ${progress.spec.task.id}`;
          const counter = chalk.gray(`[${progress.completed}/${progress.total}]`);

          if (progress.error !== undefined) {
            console.log(`${counter} ${chalk.yellow('⚠')} ${label}  ${chalk.yellow(`error: ${progress.error}`)}`);
            return;
          }

          const result = progress.result!;
          const mark = result.result.success ? chalk.green('✓') : chalk.red('✗');
          const cost = result.metrics ? formatCost(result.metrics.cost_usd) : '-';
          const duration = result.metrics ? formatDuration(result.metrics.duration_seconds) : '-';
          const score = result.score ? `score ${result.score.value.toLocaleString()}` : 'score -';
          console.log(`${counter} ${mark} ${label}  ${cost}  ${duration}  ${score}`);
        },
      });

      console.log(chalk.gray(`Output: ${benchmarkDir}`));

      let reportPath: string | null = null;
      try {
        reportPath = await generateReport(benchmarkDir);
      } catch {
        // Report generation is best-effort
      }

      console.log('');
      console.log(chalk.bold('=== Benchmark Complete ==='));
      console.log(`Runs: ${summary.total_runs} (${chalk.green(`${summary.successful_runs} passed`)}, ${chalk.red(`${summary.failed_runs} failed`)}, ${summary.errored_runs} errored)`);
      console.log(`Cost: ${formatCost(summary.total_cost_usd)}   Duration: ${formatDuration(summary.duration_seconds)}   Total Score: ${summary.total_score.toLocaleString()}`);
      if (reportPath) {
        console.log(chalk.gray(`Report: ${reportPath}`));
      }

      // Task failures are benchmark data; exit 1 only if nothing ran at all
      const allErrored = summary.errored_runs > 0 && summary.errored_runs === summary.total_runs;
      process.exit(allErrored ? 1 : 0);

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });
