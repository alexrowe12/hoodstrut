import type { BenchmarkAnalysis, RunResult } from '../core/types.js';
import { buildReportModel } from './report-model.js';
import { formatCost, formatDuration, formatPercent } from './format.js';

export interface ComparisonSide {
  label: string;
  results: RunResult[];
  analysis?: BenchmarkAnalysis;
}

function signed(value: number, digits = 0): string {
  if (value === 0) return '±0';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function percentPointDelta(a: number | null, b: number | null): string {
  if (a === null || b === null) return '-';
  return `${signed((b - a) * 100)}pp`;
}

function costDelta(a: number, b: number): string {
  const delta = b - a;
  if (delta === 0) return '±$0';
  return `${delta > 0 ? '+' : '-'}${formatCost(Math.abs(delta))}`;
}

export function generateComparisonReport(
  a: ComparisonSide,
  b: ComparisonSide,
  generatedAt: string
): string {
  const modelA = buildReportModel(a.results, a.analysis);
  const modelB = buildReportModel(b.results, b.analysis);
  const lines = [`# Comparison: ${a.label} vs ${b.label}`, '', `Generated: ${generatedAt}`, ''];
  const warnings: string[] = [];

  if (modelA.analysis.methodology !== modelB.analysis.methodology) {
    warnings.push('Methodology versions differ; ranking conclusions are not comparable.');
  }
  if (modelA.analysis.repetitions !== modelB.analysis.repetitions) {
    warnings.push(`Repetition counts differ (${modelA.analysis.repetitions} vs ${modelB.analysis.repetitions}).`);
  }
  const tasksA = new Set(modelA.tasks.map(task => task.id));
  const tasksB = new Set(modelB.tasks.map(task => task.id));
  if ([...tasksA].some(task => !tasksB.has(task)) || [...tasksB].some(task => !tasksA.has(task))) {
    warnings.push('Task sets differ.');
  }
  if (modelA.analysis.missing + modelA.analysis.errored > 0
    || modelB.analysis.missing + modelB.analysis.errored > 0) {
    warnings.push('At least one side is incomplete; deltas are descriptive and must not be treated as a winner claim.');
  }

  if (warnings.length > 0) {
    lines.push('## Compatibility Warnings', '', ...warnings.map(warning => `- ${warning}`), '');
  }

  lines.push('## Summary', '');
  lines.push(`| Metric | ${a.label} | ${b.label} | Delta |`);
  lines.push('|---|---:|---:|---:|');
  lines.push(`| Expected samples | ${modelA.aggregate.expectedRuns} | ${modelB.aggregate.expectedRuns} | ${signed(modelB.aggregate.expectedRuns - modelA.aggregate.expectedRuns)} |`);
  lines.push(`| Valid samples | ${modelA.aggregate.validRuns} | ${modelB.aggregate.validRuns} | ${signed(modelB.aggregate.validRuns - modelA.aggregate.validRuns)} |`);
  lines.push(`| Passed | ${modelA.aggregate.successfulRuns} | ${modelB.aggregate.successfulRuns} | ${signed(modelB.aggregate.successfulRuns - modelA.aggregate.successfulRuns)} |`);
  lines.push(`| Errored | ${modelA.aggregate.erroredRuns} | ${modelB.aggregate.erroredRuns} | ${signed(modelB.aggregate.erroredRuns - modelA.aggregate.erroredRuns)} |`);
  lines.push(`| Missing | ${modelA.aggregate.missingRuns} | ${modelB.aggregate.missingRuns} | ${signed(modelB.aggregate.missingRuns - modelA.aggregate.missingRuns)} |`);
  lines.push(`| Total cost | ${formatCost(modelA.aggregate.totalCost)} | ${formatCost(modelB.aggregate.totalCost)} | ${costDelta(modelA.aggregate.totalCost, modelB.aggregate.totalCost)} |`);
  lines.push(`| Total duration | ${formatDuration(modelA.aggregate.totalDuration)} | ${formatDuration(modelB.aggregate.totalDuration)} | ${formatDuration(Math.abs(modelB.aggregate.totalDuration - modelA.aggregate.totalDuration))} |`);
  lines.push('');

  const profilesA = new Map(modelA.profiles.map(profile => [profile.name, profile]));
  const profilesB = new Map(modelB.profiles.map(profile => [profile.name, profile]));
  const profileNames = [...new Set([...profilesA.keys(), ...profilesB.keys()])].sort();
  lines.push('## By Profile', '');
  lines.push(`| Profile | ${a.label} | ${b.label} | Success delta | Cost/pass delta |`);
  lines.push('|---|---|---|---:|---:|');
  for (const name of profileNames) {
    const left = profilesA.get(name);
    const right = profilesB.get(name);
    const cell = (profile: typeof left) => profile
      ? `${profile.passed}/${profile.expected_samples} (${profile.success_rate === null ? '-' : formatPercent(profile.success_rate)}) · ${profile.cost_per_pass_usd === null ? '-' : formatCost(profile.cost_per_pass_usd)}`
      : '-';
    const costDeltaCell = left?.cost_per_pass_usd !== null && left?.cost_per_pass_usd !== undefined
      && right?.cost_per_pass_usd !== null && right?.cost_per_pass_usd !== undefined
      ? costDelta(left.cost_per_pass_usd, right.cost_per_pass_usd)
      : '-';
    lines.push(`| \`${name}\` | ${cell(left)} | ${cell(right)} | ${percentPointDelta(left?.success_rate ?? null, right?.success_rate ?? null)} | ${costDeltaCell} |`);
  }
  lines.push('');

  const cellsA = new Map(modelA.analysis.task_profiles.map(cell => [`${cell.task_id}\0${cell.profile_name}`, cell]));
  const cellsB = new Map(modelB.analysis.task_profiles.map(cell => [`${cell.task_id}\0${cell.profile_name}`, cell]));
  const cellKeys = [...new Set([...cellsA.keys(), ...cellsB.keys()])].sort();
  lines.push('## By Task And Profile', '');
  lines.push(`| Task | Profile | ${a.label} | ${b.label} |`);
  lines.push('|---|---|---|---|');
  for (const key of cellKeys) {
    const [task, profile] = key.split('\0');
    const render = (cell: ReturnType<typeof cellsA.get>) => cell
      ? `${cell.passed}/${cell.expected_samples} passed · ${cell.errored} error · ${cell.missing} missing`
      : '-';
    lines.push(`| ${task} | \`${profile}\` | ${render(cellsA.get(key))} | ${render(cellsB.get(key))} |`);
  }
  lines.push('', '---', '*Generated by hoodstrut v0.1.0*');
  return lines.join('\n');
}
