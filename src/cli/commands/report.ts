import { Command } from 'commander';
import chalk from 'chalk';
import { resolve, basename } from 'node:path';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import {
  BenchmarkSummarySchema,
  RunResultSchema,
  type BenchmarkAnalysis,
  type RunResult,
} from '../../core/types.js';
import { generateAggregateReport } from '../../output/markdown.js';
import { renderReportToTerminal } from '../../output/terminal.js';
import { generateComparisonReport } from '../../output/comparison.js';
import { analyzeBenchmark } from '../../core/benchmark-analysis.js';

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

async function loadAnalysis(
  resultsDir: string,
  results?: RunResult[]
): Promise<BenchmarkAnalysis | undefined> {
  try {
    const content = await readFile(resolve(resultsDir, 'benchmark.json'), 'utf-8');
    const summary = BenchmarkSummarySchema.parse(JSON.parse(content));
    if (!summary.analysis || results === undefined) return summary.analysis;
    return analyzeBenchmark({
      results,
      repetitions: summary.analysis.repetitions,
      expectedSamples: summary.analysis.expected_sample_manifest.map(sample => ({
        runId: sample.run_id,
        profileName: sample.profile_name,
        taskId: sample.task_id,
        taskTitle: sample.task_title,
        repetition: sample.repetition,
      })),
      errors: summary.errors,
    });
  } catch {
    return undefined;
  }
}

/** Historical name retained for API compatibility; v2 reports use raw results. */
export async function loadScoredResults(resultsDir: string): Promise<RunResult[]> {
  return loadRunResults(resultsDir);
}

export async function generateReport(resultsDir: string): Promise<string> {
  const results = await loadRunResults(resultsDir);
  const analysis = await loadAnalysis(resultsDir, results);
  const report = generateAggregateReport(results, new Date().toISOString(), analysis);

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
        const [analysisA, analysisB] = await Promise.all([
          loadAnalysis(absPath, resultsA),
          loadAnalysis(comparePath, resultsB),
        ]);

        if (resultsA.length === 0 && analysisA === undefined) {
          console.log(chalk.yellow(`No results found in ${absPath}.`));
          return;
        }
        if (resultsB.length === 0 && analysisB === undefined) {
          console.log(chalk.yellow(`No results found in ${comparePath}.`));
          return;
        }

        const comparison = generateComparisonReport(
          { label: basename(absPath), results: resultsA, analysis: analysisA },
          { label: basename(comparePath), results: resultsB, analysis: analysisB },
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
      const analysis = await loadAnalysis(absPath, results);

      if (results.length === 0 && analysis === undefined) {
        console.log(chalk.yellow('No results found.'));
        return;
      }

      console.log(chalk.blue(`Found ${results.length} run(s).`));

      const report = generateAggregateReport(results, new Date().toISOString(), analysis);

      if (options.format === 'json') {
        console.log(JSON.stringify({ analysis, results }, null, 2));
      } else {
        const reportPath = resolve(absPath, 'report.md');
        await writeFile(reportPath, report, 'utf-8');
        console.log(renderReportToTerminal(results, analysis));
        console.log(chalk.green(`Report written to ${reportPath}`));
      }

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
  });
