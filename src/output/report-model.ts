import type { RunResult } from '../core/types.js';

/**
 * A single, pre-sorted view of a set of runs that every report surface renders
 * from. Everything here is already ranked by score so the markdown, the
 * terminal, and any future surface stay consistent about what "best" means.
 */

export interface AggregateStats {
  totalRuns: number;
  successfulRuns: number;
  successRate: number;
  totalCost: number;
  totalDuration: number;
  totalScore: number;
  avgScore: number;
}

export interface ProfileStats {
  name: string;
  rank: number;
  runs: number;
  successful: number;
  successRate: number;
  totalCost: number;
  avgCost: number;
  totalScore: number;
  avgScore: number;
}

export interface TaskStats {
  id: string;
  title: string;
  runs: number;
  successful: number;
  totalScore: number;
  bestProfile: string | null;
  bestScore: number;
  worstProfile: string | null;
  worstScore: number;
}

export interface MatrixCell {
  hasRun: boolean;
  success: boolean;
  score: number | null;
  cost: number | null;
  isBestInRow: boolean;
}

export interface RankedRun {
  rank: number;
  taskId: string;
  taskTitle: string;
  profile: string;
  success: boolean;
  score: number | null;
  cost: number | null;
  duration: number | null;
}

export interface ReportModel {
  aggregate: AggregateStats;
  /** Profiles ranked best → worst by total score (matrix column order). */
  profiles: ProfileStats[];
  /** Tasks ranked best → worst by total score (matrix row order). */
  tasks: TaskStats[];
  /** task.id → profile.name → cell. */
  matrix: Map<string, Map<string, MatrixCell>>;
  /** Per-profile column totals for the matrix footer. */
  profileTotals: Map<string, number>;
  /** Every run, ranked best → worst by score. */
  rankedRuns: RankedRun[];
  /** Top profile by total score, or null when there are no scored runs. */
  winner: ProfileStats | null;
}

function scoreOf(r: RunResult): number | null {
  return r.score?.value ?? null;
}

function calculateAggregate(results: RunResult[]): AggregateStats {
  const successful = results.filter(r => r.result.success);
  const totalCost = results.reduce((sum, r) => sum + (r.metrics?.cost_usd ?? 0), 0);
  const totalDuration = results.reduce((sum, r) => sum + (r.metrics?.duration_seconds ?? 0), 0);
  const scored = results.filter(r => r.score !== null);
  const totalScore = scored.reduce((sum, r) => sum + (r.score?.value ?? 0), 0);

  return {
    totalRuns: results.length,
    successfulRuns: successful.length,
    successRate: results.length > 0 ? successful.length / results.length : 0,
    totalCost,
    totalDuration,
    totalScore,
    avgScore: scored.length > 0 ? totalScore / scored.length : 0,
  };
}

function calculateProfiles(results: RunResult[]): ProfileStats[] {
  const byProfile = new Map<string, RunResult[]>();
  for (const result of results) {
    const list = byProfile.get(result.profile.name) ?? [];
    list.push(result);
    byProfile.set(result.profile.name, list);
  }

  const stats: Omit<ProfileStats, 'rank'>[] = [];
  for (const [name, runs] of byProfile) {
    const successful = runs.filter(r => r.result.success);
    const totalCost = runs.reduce((sum, r) => sum + (r.metrics?.cost_usd ?? 0), 0);
    const scored = runs.filter(r => r.score !== null);
    const totalScore = scored.reduce((sum, r) => sum + (r.score?.value ?? 0), 0);

    stats.push({
      name,
      runs: runs.length,
      successful: successful.length,
      successRate: runs.length > 0 ? successful.length / runs.length : 0,
      totalCost,
      avgCost: runs.length > 0 ? totalCost / runs.length : 0,
      totalScore,
      avgScore: scored.length > 0 ? totalScore / scored.length : 0,
    });
  }

  return stats
    .sort((a, b) => b.totalScore - a.totalScore || a.name.localeCompare(b.name))
    .map((s, i) => ({ ...s, rank: i + 1 }));
}

function calculateTasks(results: RunResult[]): TaskStats[] {
  const byTask = new Map<string, RunResult[]>();
  for (const result of results) {
    const list = byTask.get(result.task.id) ?? [];
    list.push(result);
    byTask.set(result.task.id, list);
  }

  const stats: TaskStats[] = [];
  for (const [id, runs] of byTask) {
    const successful = runs.filter(r => r.result.success);
    const scored = runs.filter(r => r.score !== null);
    const totalScore = scored.reduce((sum, r) => sum + (r.score?.value ?? 0), 0);

    let bestProfile: string | null = null;
    let bestScore = -Infinity;
    let worstProfile: string | null = null;
    let worstScore = Infinity;
    for (const r of scored) {
      const value = r.score!.value;
      if (value > bestScore) {
        bestScore = value;
        bestProfile = r.profile.name;
      }
      if (value < worstScore) {
        worstScore = value;
        worstProfile = r.profile.name;
      }
    }

    stats.push({
      id,
      title: runs[0]?.task.title ?? id,
      runs: runs.length,
      successful: successful.length,
      totalScore,
      bestProfile: scored.length > 0 ? bestProfile : null,
      bestScore: scored.length > 0 ? bestScore : 0,
      worstProfile: scored.length > 0 ? worstProfile : null,
      worstScore: scored.length > 0 ? worstScore : 0,
    });
  }

  // Rows sorted by score so the strongest tasks sit at the top of the matrix.
  return stats.sort((a, b) => b.totalScore - a.totalScore || a.id.localeCompare(b.id));
}

export function buildReportModel(results: RunResult[]): ReportModel {
  const profiles = calculateProfiles(results);
  const tasks = calculateTasks(results);

  // Build the task × profile grid, flagging the best cell in each row.
  const matrix = new Map<string, Map<string, MatrixCell>>();
  const profileTotals = new Map<string, number>();
  for (const p of profiles) {
    profileTotals.set(p.name, 0);
  }

  for (const task of tasks) {
    const row = new Map<string, MatrixCell>();
    const taskRuns = results.filter(r => r.task.id === task.id);
    for (const p of profiles) {
      const run = taskRuns.find(r => r.profile.name === p.name);
      const score = run ? scoreOf(run) : null;
      row.set(p.name, {
        hasRun: run !== undefined,
        success: run?.result.success ?? false,
        score,
        cost: run?.metrics?.cost_usd ?? null,
        isBestInRow: false,
      });
      if (score !== null) {
        profileTotals.set(p.name, (profileTotals.get(p.name) ?? 0) + score);
      }
    }
    // Flag every cell tied for the row's best score.
    if (task.bestProfile !== null) {
      for (const cell of row.values()) {
        if (cell.score !== null && cell.score === task.bestScore) {
          cell.isBestInRow = true;
        }
      }
    }
    matrix.set(task.id, row);
  }

  const rankedRuns: RankedRun[] = [...results]
    .sort((a, b) => {
      const sa = scoreOf(a);
      const sb = scoreOf(b);
      if (sa === null && sb === null) return a.task.id.localeCompare(b.task.id);
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa;
    })
    .map((r, i) => ({
      rank: i + 1,
      taskId: r.task.id,
      taskTitle: r.task.title,
      profile: r.profile.name,
      success: r.result.success,
      score: scoreOf(r),
      cost: r.metrics?.cost_usd ?? null,
      duration: r.metrics?.duration_seconds ?? null,
    }));

  return {
    aggregate: calculateAggregate(results),
    profiles,
    tasks,
    matrix,
    profileTotals,
    rankedRuns,
    winner: profiles[0] ?? null,
  };
}
