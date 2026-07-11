import { Command } from 'commander';
import chalk from 'chalk';
import { resolve } from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { RunResultSchema, type RunResult } from '../../core/types.js';
import { calculateScore } from '../../core/scorer.js';
import { generateAggregateReport } from '../../output/markdown.js';

async function loadRunResults(resultsDir: string): Promise<RunResult[]> {
  const entries = await readdir(resultsDir, { withFileTypes: true });
  const results: RunResult[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('run-')) {
      continue;
    }

    const resultPath = resolve(resultsDir, entry.name, 'run-result.json');
    try {
      const content = await readFile(resultPath, 'utf-8');
      const data = JSON.parse(content);
      const parsed = RunResultSchema.parse(data);
      results.push(parsed);
    } catch {
      // Skip invalid or missing results
    }
  }

  return results;
}

function backfillScore(result: RunResult): RunResult {
  if (result.score !== null) {
    return result;
  }

  const score = calculateScore({
    success: result.result.success,
    actualCost: result.metrics?.cost_usd ?? null,
    duration: result.metrics?.duration_seconds ?? 0,
    difficulty: result.task.difficulty as 'easy' | 'medium' | 'hard' | 'expert' | undefined,
    profileModel: result.profile.model,
  });

  return { ...result, score };
}

export async function generateReport(resultsDir: string): Promise<string> {
  const results = await loadRunResults(resultsDir);

  if (results.length === 0) {
    return generateAggregateReport([], new Date().toISOString());
  }

  const scoredResults = results.map(backfillScore);
  const report = generateAggregateReport(scoredResults, new Date().toISOString());

  const reportPath = resolve(resultsDir, 'report.md');
  await writeFile(reportPath, report, 'utf-8');

  return reportPath;
}

export const reportCommand = new Command('report')
  .description('Generate aggregate report from benchmark results')
  .argument('[results]', 'Path to results directory', './results')
  .option('-f, --format <format>', 'Output format (markdown)', 'markdown')
  .action(async (resultsPath, options) => {
    try {
      const absPath = resolve(resultsPath);
      console.log(chalk.blue(`Scanning results in ${absPath}...`));

      const results = await loadRunResults(absPath);

      if (results.length === 0) {
        console.log(chalk.yellow('No results found.'));
        return;
      }

      console.log(chalk.blue(`Found ${results.length} run(s).`));

      const scoredResults = results.map(backfillScore);
      const needsBackfill = results.filter(r => r.score === null).length;
      if (needsBackfill > 0) {
        console.log(chalk.blue(`Backfilled scores for ${needsBackfill} run(s).`));
      }

      const report = generateAggregateReport(scoredResults, new Date().toISOString());

      if (options.format === 'json') {
        console.log(JSON.stringify(scoredResults, null, 2));
      } else {
        const reportPath = resolve(absPath, 'report.md');
        await writeFile(reportPath, report, 'utf-8');
        console.log(chalk.green(`Report written to ${reportPath}`));
        console.log('');
        console.log(report);
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });
