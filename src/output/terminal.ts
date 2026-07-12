import chalk from 'chalk';
import type { RunResult } from '../core/types.js';
import { buildReportModel, type ProfileStats } from './report-model.js';
import { formatCost, formatDuration, formatPercent, formatScore } from './format.js';

type Align = 'left' | 'right';

interface Cell {
  text: string;
  paint?: (s: string) => string;
}

const GOLD = chalk.hex('#f5c542');
const SILVER = chalk.hex('#c0c6cf');
const BRONZE = chalk.hex('#cd8a4b');

function rankPaint(rank: number): (s: string) => string {
  if (rank === 1) return (s) => GOLD.bold(s);
  if (rank === 2) return (s) => SILVER(s);
  if (rank === 3) return (s) => BRONZE(s);
  return (s) => chalk.dim(s);
}

/**
 * Render an aligned table. Column widths are measured from the *plain* text
 * (before color is applied) so ANSI codes never break alignment.
 */
function renderTable(headers: Cell[], rows: Cell[][], aligns: Align[]): string[] {
  const cols = headers.length;
  const widths = new Array<number>(cols).fill(0);
  const measure = (cell: Cell | undefined) => (cell ? cell.text.length : 0);

  headers.forEach((h, i) => (widths[i] = Math.max(widths[i], measure(h))));
  rows.forEach((r) => r.forEach((c, i) => (widths[i] = Math.max(widths[i], measure(c)))));

  const pad = (cell: Cell, i: number): string => {
    const align = aligns[i] ?? 'left';
    const padded = align === 'right' ? cell.text.padStart(widths[i]) : cell.text.padEnd(widths[i]);
    return cell.paint ? cell.paint(padded) : padded;
  };

  const out: string[] = [];
  out.push(headers.map((h, i) => pad({ ...h, paint: h.paint ?? ((s) => chalk.bold(s)) }, i)).join('  '));
  out.push(widths.map((w) => chalk.dim('─'.repeat(w))).join('  '));
  rows.forEach((r) => out.push(r.map((c, i) => pad(c, i)).join('  ')));
  return out;
}

function paintScoreCell(score: number | null, isBest: boolean, hasRun: boolean, success: boolean): Cell {
  if (!hasRun) {
    return { text: '—', paint: (s) => chalk.dim(s) };
  }
  const text = formatScore(score);
  if (!success) {
    return { text, paint: (s) => chalk.red(s) };
  }
  if (isBest) {
    return { text, paint: (s) => chalk.green.bold(s) };
  }
  return { text };
}

/**
 * The colorized, terminal-native view of a benchmark: winner banner, score
 * matrix, and profile leaderboard. This is the "wow" surface — full ANSI color
 * that `report.md` (plain markdown) can't carry.
 */
export function renderReportToTerminal(results: RunResult[]): string {
  if (results.length === 0) {
    return chalk.yellow('No results to report.');
  }

  const model = buildReportModel(results);
  const { aggregate, profiles, tasks, matrix, profileTotals, winner } = model;
  const out: string[] = [];

  out.push('');
  out.push(chalk.bold.underline('🏆 Benchmark Results'));
  out.push('');

  // Winner banner.
  if (winner && profiles.length > 1) {
    out.push(
      GOLD.bold('  🥇 Winner: ') +
      chalk.bold(winner.name) +
      chalk.dim('  ·  ') +
      chalk.green.bold(`${formatScore(winner.totalScore)} pts`) +
      chalk.dim(`  ·  ${winner.successful}/${winner.runs} passed  ·  ${formatCost(winner.totalCost)}`)
    );
    out.push('');
  }

  // Summary line.
  const passColor = aggregate.successfulRuns === aggregate.totalRuns ? chalk.green : chalk.yellow;
  out.push(
    chalk.dim('  ') +
    `${aggregate.totalRuns} runs  ` +
    passColor(`${aggregate.successfulRuns}/${aggregate.totalRuns} passed`) +
    chalk.dim('  ·  ') +
    `${formatCost(aggregate.totalCost)}` +
    chalk.dim('  ·  ') +
    `${formatDuration(aggregate.totalDuration)}` +
    chalk.dim('  ·  ') +
    `score ${formatScore(aggregate.totalScore)}`
  );
  out.push('');

  // Score matrix.
  out.push(chalk.bold('📊 Score Matrix') + chalk.dim('  (rows & columns ranked by score · ') + chalk.green('best') + chalk.dim(' / ') + chalk.red('fail') + chalk.dim(')'));
  out.push('');

  const matrixHeaders: Cell[] = [
    { text: 'Task' },
    ...profiles.map((p) => ({ text: p.name, paint: p.rank === 1 ? (s: string) => GOLD.bold(s) : undefined })),
  ];
  const matrixRows: Cell[][] = tasks.map((task) => {
    const row = matrix.get(task.id)!;
    return [
      { text: task.id },
      ...profiles.map((p) => {
        const c = row.get(p.name)!;
        return paintScoreCell(c.score, c.isBestInRow, c.hasRun, c.success);
      }),
    ];
  });
  // Totals footer row.
  matrixRows.push([
    { text: 'Total', paint: (s) => chalk.bold(s) },
    ...profiles.map((p) => ({
      text: formatScore(profileTotals.get(p.name) ?? 0),
      paint: (s: string) => chalk.bold(s),
    })),
  ]);
  const matrixAligns: Align[] = ['left', ...profiles.map(() => 'right' as Align)];
  for (const line of renderTable(matrixHeaders, matrixRows, matrixAligns)) {
    out.push('  ' + line);
  }
  out.push('');

  // Leaderboard.
  out.push(chalk.bold('🏅 Profile Leaderboard'));
  out.push('');
  const lbHeaders: Cell[] = [
    { text: '#' },
    { text: 'Profile' },
    { text: 'Score' },
    { text: 'Avg' },
    { text: 'Passed' },
    { text: 'Cost' },
  ];
  const lbRows: Cell[][] = profiles.map((p: ProfileStats) => {
    const paint = rankPaint(p.rank);
    return [
      { text: String(p.rank), paint },
      { text: p.name, paint },
      { text: formatScore(p.totalScore), paint },
      { text: formatScore(p.avgScore) },
      { text: `${p.successful}/${p.runs} (${formatPercent(p.successRate)})`, paint: p.successful === p.runs ? (s) => chalk.green(s) : (s) => chalk.yellow(s) },
      { text: formatCost(p.totalCost) },
    ];
  });
  const lbAligns: Align[] = ['right', 'left', 'right', 'right', 'right', 'right'];
  for (const line of renderTable(lbHeaders, lbRows, lbAligns)) {
    out.push('  ' + line);
  }
  out.push('');

  return out.join('\n');
}
