import type { RunResult } from '../core/types.js';
import { formatCost, formatPercent } from './format.js';

export interface ComparisonSide {
  label: string;
  results: RunResult[];
}

interface SideTotals {
  runs: number;
  successRate: number;
  totalCost: number;
  totalTokens: number;
  totalScore: number;
}

function calculateTotals(results: RunResult[]): SideTotals {
  const successful = results.filter(r => r.result.success).length;
  return {
    runs: results.length,
    successRate: results.length > 0 ? successful / results.length : 0,
    totalCost: results.reduce((sum, r) => sum + (r.metrics?.cost_usd ?? 0), 0),
    totalTokens: results.reduce((sum, r) => sum + (r.metrics?.tokens.total_tokens ?? 0), 0),
    totalScore: results.reduce((sum, r) => sum + (r.score?.value ?? 0), 0),
  };
}

function signed(value: number, format: (n: number) => string = n => n.toLocaleString()): string {
  if (value === 0) {
    return '±0';
  }
  return value > 0 ? `+${format(value)}` : `-${format(Math.abs(value))}`;
}

function deltaPercentPoints(a: number, b: number): string {
  const pp = Math.round((b - a) * 100);
  return pp === 0 ? '±0pp' : `${pp > 0 ? '+' : ''}${pp}pp`;
}

function deltaCost(a: number, b: number): string {
  const diff = b - a;
  if (diff === 0) {
    return '±$0';
  }
  const sign = diff > 0 ? '+' : '-';
  const pct = a > 0 ? ` (${sign}${Math.round(Math.abs(diff) / a * 100)}%)` : '';
  return `${sign}${formatCost(Math.abs(diff))}${pct}`;
}

function successMark(result: RunResult): string {
  return result.result.success ? '✓' : '✗';
}

function costCell(result: RunResult): string {
  return result.metrics ? formatCost(result.metrics.cost_usd) : '-';
}

function scoreCell(result: RunResult): string {
  return result.score ? result.score.value.toLocaleString() : '-';
}

interface ProfileAggregate {
  runs: number;
  successful: number;
  totalCost: number;
  totalScore: number;
}

function aggregateByProfile(results: RunResult[]): Map<string, ProfileAggregate> {
  const byProfile = new Map<string, ProfileAggregate>();
  for (const result of results) {
    const name = result.profile.name;
    const agg = byProfile.get(name) ?? { runs: 0, successful: 0, totalCost: 0, totalScore: 0 };
    agg.runs++;
    if (result.result.success) {
      agg.successful++;
    }
    agg.totalCost += result.metrics?.cost_usd ?? 0;
    agg.totalScore += result.score?.value ?? 0;
    byProfile.set(name, agg);
  }
  return byProfile;
}

export function generateComparisonReport(
  a: ComparisonSide,
  b: ComparisonSide,
  generatedAt: string
): string {
  const lines: string[] = [];

  lines.push(`# Comparison: ${a.label} vs ${b.label}`);
  lines.push('');
  lines.push(`Generated: ${generatedAt}`);
  lines.push('');

  // Summary
  const totalsA = calculateTotals(a.results);
  const totalsB = calculateTotals(b.results);

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | ${a.label} | ${b.label} | Δ |`);
  lines.push('|--------|------|------|---|');
  lines.push(`| Runs | ${totalsA.runs} | ${totalsB.runs} | ${totalsA.runs === totalsB.runs ? '—' : signed(totalsB.runs - totalsA.runs)} |`);
  lines.push(`| Success Rate | ${formatPercent(totalsA.successRate)} | ${formatPercent(totalsB.successRate)} | ${deltaPercentPoints(totalsA.successRate, totalsB.successRate)} |`);
  lines.push(`| Total Cost | ${formatCost(totalsA.totalCost)} | ${formatCost(totalsB.totalCost)} | ${deltaCost(totalsA.totalCost, totalsB.totalCost)} |`);
  lines.push(`| Total Tokens | ${totalsA.totalTokens.toLocaleString()} | ${totalsB.totalTokens.toLocaleString()} | ${signed(totalsB.totalTokens - totalsA.totalTokens)} |`);
  lines.push(`| Total Score | ${totalsA.totalScore.toLocaleString()} | ${totalsB.totalScore.toLocaleString()} | ${signed(totalsB.totalScore - totalsA.totalScore)} |`);
  lines.push('');

  // By run: match on (task.id, profile.name)
  const keyOf = (r: RunResult) => `${r.task.id}::${r.profile.name}`;
  const mapA = new Map(a.results.map(r => [keyOf(r), r]));
  const mapB = new Map(b.results.map(r => [keyOf(r), r]));
  const allKeys = [...new Set([...mapA.keys(), ...mapB.keys()])].sort();

  lines.push('## By Run');
  lines.push('');
  lines.push(`| Task | Profile | ${a.label} | ${b.label} | Cost Δ | Score Δ |`);
  lines.push('|------|---------|------|------|--------|---------|');

  for (const key of allKeys) {
    const [taskId, profileName] = key.split('::');
    const runA = mapA.get(key);
    const runB = mapB.get(key);

    if (runA && runB) {
      const bothCosted = runA.metrics && runB.metrics;
      const costDelta = bothCosted ? deltaCost(runA.metrics!.cost_usd, runB.metrics!.cost_usd) : '-';
      const bothScored = runA.score && runB.score;
      const scoreDelta = bothScored ? signed(runB.score!.value - runA.score!.value) : '-';
      lines.push(`| ${taskId} | ${profileName} | ${successMark(runA)} ${costCell(runA)} (${scoreCell(runA)}) | ${successMark(runB)} ${costCell(runB)} (${scoreCell(runB)}) | ${costDelta} | ${scoreDelta} |`);
    } else if (runA) {
      lines.push(`| ${taskId} | ${profileName} | ${successMark(runA)} ${costCell(runA)} (${scoreCell(runA)}) | — *(only in ${a.label})* | - | - |`);
    } else if (runB) {
      lines.push(`| ${taskId} | ${profileName} | — *(only in ${b.label})* | ${successMark(runB)} ${costCell(runB)} (${scoreCell(runB)}) | - | - |`);
    }
  }
  lines.push('');
  lines.push('*Cell format: success, cost, (score)*');
  lines.push('');

  // By profile
  const profilesA = aggregateByProfile(a.results);
  const profilesB = aggregateByProfile(b.results);
  const allProfiles = [...new Set([...profilesA.keys(), ...profilesB.keys()])].sort();

  lines.push('## By Profile');
  lines.push('');
  lines.push(`| Profile | ${a.label} | ${b.label} | Success Δ | Cost Δ | Score Δ |`);
  lines.push('|---------|------|------|-----------|--------|---------|');

  for (const name of allProfiles) {
    const aggA = profilesA.get(name);
    const aggB = profilesB.get(name);

    const cell = (agg: ProfileAggregate) =>
      `${agg.successful}/${agg.runs} · ${formatCost(agg.totalCost)} · ${agg.totalScore.toLocaleString()}`;

    if (aggA && aggB) {
      const rateA = aggA.runs > 0 ? aggA.successful / aggA.runs : 0;
      const rateB = aggB.runs > 0 ? aggB.successful / aggB.runs : 0;
      lines.push(`| ${name} | ${cell(aggA)} | ${cell(aggB)} | ${deltaPercentPoints(rateA, rateB)} | ${deltaCost(aggA.totalCost, aggB.totalCost)} | ${signed(aggB.totalScore - aggA.totalScore)} |`);
    } else if (aggA) {
      lines.push(`| ${name} | ${cell(aggA)} | — *(only in ${a.label})* | - | - | - |`);
    } else if (aggB) {
      lines.push(`| ${name} | — *(only in ${b.label})* | ${cell(aggB)} | - | - | - |`);
    }
  }
  lines.push('');
  lines.push('*Cell format: successes/runs · cost · score*');
  lines.push('');

  lines.push('---');
  lines.push('*Generated by hoodstrut v0.1.0*');

  return lines.join('\n');
}
