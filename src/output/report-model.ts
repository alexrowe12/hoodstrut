import type {
  BenchmarkAnalysis,
  ProfileAnalysis,
  RunResult,
  TaskProfileAnalysis,
} from '../core/types.js';
import { analyzeBenchmark } from '../core/benchmark-analysis.js';

export interface AggregateStats {
  expectedRuns: number;
  observedRuns: number;
  validRuns: number;
  successfulRuns: number;
  failedRuns: number;
  timedOutRuns: number;
  erroredRuns: number;
  missingRuns: number;
  totalCost: number;
  totalDuration: number;
}

export type ProfileStats = ProfileAnalysis;

export interface TaskStats {
  id: string;
  title: string;
}

export interface MatrixCell extends TaskProfileAnalysis {
  complete: boolean;
  isBestInRow: boolean;
}

export interface RankedRun {
  taskId: string;
  taskTitle: string;
  profile: string;
  repetition: number;
  status: string;
  cost: number | null;
  duration: number | null;
}

export interface ReportModel {
  analysis: BenchmarkAnalysis;
  aggregate: AggregateStats;
  profiles: ProfileStats[];
  tasks: TaskStats[];
  matrix: Map<string, Map<string, MatrixCell>>;
  rankedRuns: RankedRun[];
}

function inferRepetitions(results: RunResult[]): number {
  const counts = new Map<string, number>();
  for (const result of results) {
    const key = `${result.profile.name}\0${result.task.id}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Math.max(1, ...counts.values());
}

function statusOf(result: RunResult): string {
  return result.result.status ?? (result.result.success ? 'passed' : 'failed');
}

export function buildReportModel(
  results: RunResult[],
  persistedAnalysis?: BenchmarkAnalysis
): ReportModel {
  const analysis = persistedAnalysis ?? analyzeBenchmark({
    results,
    repetitions: inferRepetitions(results),
  });
  const taskMap = new Map(
    analysis.task_profiles.map(cell => [cell.task_id, cell.task_title])
  );
  const tasks = [...taskMap].map(([id, title]) => ({ id, title }));
  const profiles = analysis.profiles;
  const matrix = new Map<string, Map<string, MatrixCell>>();

  for (const task of tasks) {
    const row = new Map<string, MatrixCell>();
    const cells = analysis.task_profiles.filter(cell => cell.task_id === task.id);
    const completeCells = cells.filter(cell => cell.valid_samples === cell.expected_samples);
    const bestPasses = completeCells.length > 0
      ? Math.max(...completeCells.map(cell => cell.passed))
      : -1;
    const correctnessLeaders = completeCells.filter(cell => cell.passed === bestPasses);
    const bestCost = correctnessLeaders.reduce(
      (best, cell) => cell.mean_cost_usd === null ? best : Math.min(best, cell.mean_cost_usd),
      Number.POSITIVE_INFINITY
    );

    for (const cell of cells) {
      const complete = cell.valid_samples === cell.expected_samples
        && cell.errored === 0
        && cell.missing === 0;
      row.set(cell.profile_name, {
        ...cell,
        complete,
        isBestInRow: complete
          && cell.passed === bestPasses
          && (correctnessLeaders.length === 1 || cell.mean_cost_usd === bestCost),
      });
    }
    matrix.set(task.id, row);
  }

  const rankedRuns = [...results]
    .sort((a, b) =>
      a.task.id.localeCompare(b.task.id)
      || a.profile.name.localeCompare(b.profile.name)
      || (a.repetition ?? 1) - (b.repetition ?? 1)
    )
    .map(result => ({
      taskId: result.task.id,
      taskTitle: result.task.title,
      profile: result.profile.name,
      repetition: result.repetition ?? 1,
      status: statusOf(result),
      cost: result.metrics?.cost_usd ?? null,
      duration: result.metrics?.duration_seconds ?? null,
    }));

  return {
    analysis,
    aggregate: {
      expectedRuns: analysis.expected_samples,
      observedRuns: analysis.observed_samples,
      validRuns: analysis.valid_samples,
      successfulRuns: analysis.passed,
      failedRuns: analysis.failed,
      timedOutRuns: analysis.timed_out,
      erroredRuns: analysis.errored,
      missingRuns: analysis.missing,
      totalCost: profiles.reduce((sum, profile) => sum + profile.total_cost_usd, 0),
      totalDuration: profiles.reduce((sum, profile) => sum + profile.total_duration_seconds, 0),
    },
    profiles,
    tasks,
    matrix,
    rankedRuns,
  };
}
