import chalk from 'chalk';
import type { BenchmarkAnalysis, RunResult } from '../core/types.js';
import { buildReportModel } from './report-model.js';
import { formatCost, formatDuration, formatPercent } from './format.js';

function pad(value: string, width: number, right = false): string {
  return right ? value.padStart(width) : value.padEnd(width);
}

function table(headers: string[], rows: string[][], rightColumns: Set<number>): string[] {
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map(row => row[index]?.length ?? 0)
  ));
  const render = (row: string[]) => row.map((value, index) =>
    pad(value, widths[index], rightColumns.has(index))
  ).join('  ');
  return [chalk.bold(render(headers)), chalk.dim(widths.map(width => '-'.repeat(width)).join('  ')), ...rows.map(render)];
}

export function renderReportToTerminal(
  results: RunResult[],
  persistedAnalysis?: BenchmarkAnalysis
): string {
  if (results.length === 0 && persistedAnalysis === undefined) return chalk.yellow('No results to report.');
  const { analysis, aggregate, profiles, tasks, matrix } = buildReportModel(results, persistedAnalysis);
  const out: string[] = ['', chalk.bold.underline('Benchmark Results'), ''];

  const decision = analysis.decision.winner
    ? chalk.green.bold(`Winner: ${analysis.decision.winner}`)
    : analysis.decision.leader
      ? chalk.yellow.bold(`Provisional leader: ${analysis.decision.leader}`)
      : chalk.yellow.bold('No eligible leader');
  out.push(`  ${decision}`);
  out.push(chalk.dim(`  ${analysis.decision.reason}`));
  out.push('');
  out.push(
    `  ${aggregate.validRuns}/${aggregate.expectedRuns} valid  ·  `
    + `${aggregate.successfulRuns} passed  ·  ${aggregate.failedRuns} failed  ·  `
    + `${aggregate.timedOutRuns} timed out  ·  ${aggregate.erroredRuns} errored  ·  `
    + `${aggregate.missingRuns} missing`
  );
  out.push(`  ${formatCost(aggregate.totalCost)}  ·  ${formatDuration(aggregate.totalDuration)}  ·  ${analysis.repetitions} repetition(s)`);
  out.push('');

  out.push(chalk.bold('Results Matrix'));
  const matrixRows = tasks.map(task => {
    const row = matrix.get(task.id)!;
    return [task.id, ...profiles.map(profile => {
      const cell = row.get(profile.name)!;
      if (!cell.complete) return `${cell.passed}/${cell.expected_samples} incomplete`;
      return `${cell.passed}/${cell.expected_samples} ${cell.mean_cost_usd === null ? '-' : formatCost(cell.mean_cost_usd)}`;
    })];
  });
  out.push(...table(['Task', ...profiles.map(profile => profile.name)], matrixRows, new Set(profiles.map((_, index) => index + 1))).map(line => `  ${line}`));
  out.push('');

  out.push(chalk.bold('Profile Ranking'));
  const profileRows = profiles.map(profile => [
    profile.rank === null ? '-' : String(profile.rank),
    profile.name,
    `${profile.valid_samples}/${profile.expected_samples}`,
    String(profile.passed),
    profile.success_rate === null ? '-' : formatPercent(profile.success_rate),
    profile.cost_per_pass_usd === null ? '-' : formatCost(profile.cost_per_pass_usd),
    profile.duration_per_pass_seconds === null ? '-' : formatDuration(profile.duration_per_pass_seconds),
    profile.eligible ? 'eligible' : 'ineligible',
  ]);
  out.push(...table(
    ['#', 'Profile', 'Coverage', 'Passed', 'Success', 'Cost/pass', 'Time/pass', 'Status'],
    profileRows,
    new Set([0, 2, 3, 4, 5, 6])
  ).map(line => `  ${line}`));
  out.push('');
  return out.join('\n');
}
