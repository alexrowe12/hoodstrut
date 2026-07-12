import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, basename } from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { RunResultSchema, type RunResult } from '../../core/types.js';
import { calculateScore } from '../../core/scorer.js';
import { generateAggregateReport } from '../../output/markdown.js';
import { renderReportToTerminal } from '../../output/terminal.js';
import { generateComparisonReport } from '../../output/comparison.js';

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

/** Load every run in a results directory with scores backfilled where missing. */
export async function loadScoredResults(resultsDir: string): Promise<RunResult[]> {
  const results = await loadRunResults(resultsDir);
  return results.map(backfillScore);
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
  .option('--compare <directory>', 'Compare against a second results directory')
  .action(async (resultsPath, options) => {
    try {
      const absPath = resolve(resultsPath);

      if (options.compare) {
        const comparePath = resolve(options.compare);
        console.log(chalk.blue(`Comparing ${absPath} vs ${comparePath}...`));

        const [resultsA, resultsB] = await Promise.all([
          loadRunResults(absPath),
          loadRunResults(comparePath),
        ]);

        if (resultsA.length === 0) {
          console.log(chalk.yellow(`No results found in ${absPath}.`));
          return;
        }
        if (resultsB.length === 0) {
          console.log(chalk.yellow(`No results found in ${comparePath}.`));
          return;
        }

        const comparison = generateComparisonReport(
          { label: basename(absPath), results: resultsA.map(backfillScore) },
          { label: basename(comparePath), results: resultsB.map(backfillScore) },
          new Date().toISOString()
        );

        const comparisonPath = resolve(absPath, 'comparison.md');
        await writeFile(comparisonPath, comparison, 'utf-8');
        console.log(chalk.green(`Comparison written to ${comparisonPath}`));
        console.log('');
        console.log(comparison);
        return;
      }

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
        console.log(renderReportToTerminal(scoredResults));
        console.log(chalk.green(`Report written to ${reportPath}`));
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });
