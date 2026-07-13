import type {
  BenchmarkAnalysis,
  ProfileAnalysis,
  RunResult,
  TaskProfileAnalysis,
} from './types.js';
import { summarizeDistribution, wilsonInterval } from './statistics.js';

export interface ExpectedBenchmarkSample {
  runId: string;
  profileName: string;
  taskId: string;
  taskTitle: string;
  repetition: number;
}

export interface AnalysisError {
  run_id: string;
}

export interface BenchmarkAnalysisInput {
  results: RunResult[];
  repetitions: number;
  expectedSamples?: ExpectedBenchmarkSample[];
  errors?: AnalysisError[];
}

type Outcome = 'passed' | 'failed' | 'timed_out' | 'errored';

function outcomeOf(result: RunResult): Outcome {
  const status = result.result.status;
  if (status === 'timed_out') return 'timed_out';
  if (status === 'agent_error' || status === 'verification_error' || status === 'judge_error') {
    return 'errored';
  }
  if (result.metrics === null) return 'errored';
  if (status === 'passed' || result.result.success) return 'passed';
  return 'failed';
}

function compareProfiles(a: ProfileAnalysis, b: ProfileAnalysis): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  if (a.passed !== b.passed) return b.passed - a.passed;
  const aCost = a.cost_per_pass_usd ?? Number.POSITIVE_INFINITY;
  const bCost = b.cost_per_pass_usd ?? Number.POSITIVE_INFINITY;
  if (aCost !== bCost) return aCost - bCost;
  const aDuration = a.duration_per_pass_seconds ?? Number.POSITIVE_INFINITY;
  const bDuration = b.duration_per_pass_seconds ?? Number.POSITIVE_INFINITY;
  return aDuration - bDuration || a.name.localeCompare(b.name);
}

function intervalsShowLower(
  leader: { confidence_interval_95: { upper: number } | null },
  competitor: { confidence_interval_95: { lower: number } | null }
): boolean {
  return leader.confidence_interval_95 !== null
    && competitor.confidence_interval_95 !== null
    && leader.confidence_interval_95.upper < competitor.confidence_interval_95.lower;
}

function isConfidentlyBetter(leader: ProfileAnalysis, competitor: ProfileAnalysis): boolean {
  if (leader.passed > competitor.passed) {
    const leaderInterval = leader.success_confidence_interval_95;
    const competitorInterval = competitor.success_confidence_interval_95;
    return leaderInterval !== null
      && competitorInterval !== null
      && leaderInterval.lower > competitorInterval.upper;
  }
  if (leader.passed !== competitor.passed) return false;

  const leaderCost = leader.cost_per_pass_usd;
  const competitorCost = competitor.cost_per_pass_usd;
  if (leaderCost !== null && competitorCost !== null && leaderCost < competitorCost) {
    return intervalsShowLower(leader.cost, competitor.cost);
  }
  if (leaderCost !== competitorCost) return false;

  const leaderDuration = leader.duration_per_pass_seconds;
  const competitorDuration = competitor.duration_per_pass_seconds;
  return leaderDuration !== null
    && competitorDuration !== null
    && leaderDuration < competitorDuration
    && intervalsShowLower(leader.duration, competitor.duration);
}

function inferExpectedSamples(results: RunResult[], repetitions: number): ExpectedBenchmarkSample[] {
  const profiles = [...new Set(results.map(result => result.profile.name))];
  const tasks = new Map(results.map(result => [result.task.id, result.task.title]));
  const samples: ExpectedBenchmarkSample[] = [];
  for (const profileName of profiles) {
    for (const [taskId, taskTitle] of tasks) {
      const group = results.filter(result =>
        result.profile.name === profileName && result.task.id === taskId
      );
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        const existing = group.find(result => (result.repetition ?? group.indexOf(result) + 1) === repetition);
        samples.push({
          runId: existing?.id ?? `${profileName}::${taskId}::${repetition}`,
          profileName,
          taskId,
          taskTitle,
          repetition,
        });
      }
    }
  }
  return samples;
}

export function analyzeBenchmark(input: BenchmarkAnalysisInput): BenchmarkAnalysis {
  const expectedSamples = input.expectedSamples
    ?? inferExpectedSamples(input.results, input.repetitions);
  const resultById = new Map(input.results.map(result => [result.id, result]));
  const errorIds = new Set((input.errors ?? []).map(error => error.run_id));
  const profiles = [...new Set(expectedSamples.map(sample => sample.profileName))];
  const tasks = new Map(expectedSamples.map(sample => [sample.taskId, sample.taskTitle]));

  const buildCounts = (samples: ExpectedBenchmarkSample[]) => {
    const results = samples
      .map(sample => resultById.get(sample.runId))
      .filter((result): result is RunResult => result !== undefined);
    const outcomes = results.map(outcomeOf);
    const externalErrors = samples.filter(sample =>
      errorIds.has(sample.runId) && !resultById.has(sample.runId)
    ).length;
    const passed = outcomes.filter(outcome => outcome === 'passed').length;
    const failed = outcomes.filter(outcome => outcome === 'failed').length;
    const timedOut = outcomes.filter(outcome => outcome === 'timed_out').length;
    const errored = outcomes.filter(outcome => outcome === 'errored').length + externalErrors;
    const valid = passed + failed + timedOut;
    const observed = results.length + externalErrors;
    const missing = Math.max(0, samples.length - observed);
    const costs = results
      .filter(result => outcomeOf(result) !== 'errored' && result.metrics !== null)
      .map(result => result.metrics!.cost_usd);
    const durations = results
      .filter(result => outcomeOf(result) !== 'errored' && result.metrics !== null)
      .map(result => result.metrics!.duration_seconds);
    return {
      results,
      passed,
      failed,
      timedOut,
      errored,
      valid,
      observed,
      missing,
      costs,
      durations,
    };
  };

  const taskProfiles: TaskProfileAnalysis[] = [];
  for (const [taskId, taskTitle] of tasks) {
    for (const profileName of profiles) {
      const samples = expectedSamples.filter(sample =>
        sample.profileName === profileName && sample.taskId === taskId
      );
      const counts = buildCounts(samples);
      const cost = summarizeDistribution(counts.costs);
      const duration = summarizeDistribution(counts.durations);
      taskProfiles.push({
        task_id: taskId,
        task_title: taskTitle,
        profile_name: profileName,
        expected_samples: samples.length,
        observed_samples: counts.observed,
        valid_samples: counts.valid,
        passed: counts.passed,
        failed: counts.failed,
        timed_out: counts.timedOut,
        errored: counts.errored,
        missing: counts.missing,
        success_rate: counts.valid > 0 ? counts.passed / counts.valid : null,
        success_confidence_interval_95: wilsonInterval(counts.passed, counts.valid),
        mean_cost_usd: cost.mean,
        mean_duration_seconds: duration.mean,
      });
    }
  }

  const profileAnalyses: ProfileAnalysis[] = profiles.map(name => {
    const samples = expectedSamples.filter(sample => sample.profileName === name);
    const counts = buildCounts(samples);
    const cost = summarizeDistribution(counts.costs);
    const duration = summarizeDistribution(counts.durations);
    return {
      name,
      expected_samples: samples.length,
      observed_samples: counts.observed,
      valid_samples: counts.valid,
      passed: counts.passed,
      failed: counts.failed,
      timed_out: counts.timedOut,
      errored: counts.errored,
      missing: counts.missing,
      completion_rate: samples.length > 0 ? counts.valid / samples.length : 0,
      success_rate: counts.valid > 0 ? counts.passed / counts.valid : null,
      success_confidence_interval_95: wilsonInterval(counts.passed, counts.valid),
      total_cost_usd: counts.costs.reduce((sum, value) => sum + value, 0),
      cost_per_pass_usd: counts.passed > 0
        ? counts.costs.reduce((sum, value) => sum + value, 0) / counts.passed
        : null,
      total_duration_seconds: counts.durations.reduce((sum, value) => sum + value, 0),
      duration_per_pass_seconds: counts.passed > 0
        ? counts.durations.reduce((sum, value) => sum + value, 0) / counts.passed
        : null,
      cost,
      duration,
      eligible: counts.valid === samples.length && counts.errored === 0 && counts.missing === 0,
      rank: null,
    };
  });

  profileAnalyses.sort(compareProfiles);
  let rank = 0;
  for (const profile of profileAnalyses) {
    if (profile.eligible) profile.rank = ++rank;
  }

  const eligible = profileAnalyses.filter(profile => profile.eligible);
  const leader = eligible[0] ?? null;
  let decision: BenchmarkAnalysis['decision'];
  if (profileAnalyses.some(profile => !profile.eligible)) {
    decision = {
      leader: leader?.name ?? null,
      winner: null,
      status: 'incomplete',
      reason: 'At least one profile has missing, errored, or unusable samples.',
    };
  } else if (eligible.length < 2) {
    decision = {
      leader: leader?.name ?? null,
      winner: null,
      status: 'insufficient_competitors',
      reason: 'At least two complete profiles are required to declare a winner.',
    };
  } else if (input.repetitions < 2) {
    decision = {
      leader: leader?.name ?? null,
      winner: null,
      status: 'insufficient_repetitions',
      reason: 'One repetition cannot estimate variance or support a winner claim.',
    };
  } else if (eligible.every(profile =>
    profile.passed === leader!.passed
    && profile.total_cost_usd === leader!.total_cost_usd
    && profile.total_duration_seconds === leader!.total_duration_seconds
  )) {
    decision = {
      leader: leader?.name ?? null,
      winner: null,
      status: 'tie',
      reason: 'Eligible profiles are tied on correctness, cost, and duration.',
    };
  } else if (leader && eligible.slice(1).every(profile => isConfidentlyBetter(leader, profile))) {
    decision = {
      leader: leader.name,
      winner: leader.name,
      status: 'winner',
      reason: 'The leader is better under the correctness-first ordering with non-overlapping 95% confidence intervals.',
    };
  } else {
    decision = {
      leader: leader?.name ?? null,
      winner: null,
      status: 'inconclusive',
      reason: 'The point estimates have a leader, but the 95% confidence intervals do not support a winner claim.',
    };
  }

  const overall = buildCounts(expectedSamples);
  return {
    methodology: 'lexicographic-v2',
    confidence_level: 0.95,
    repetitions: input.repetitions,
    expected_samples: expectedSamples.length,
    observed_samples: overall.observed,
    valid_samples: overall.valid,
    passed: overall.passed,
    failed: overall.failed,
    timed_out: overall.timedOut,
    errored: overall.errored,
    missing: overall.missing,
    expected_sample_manifest: expectedSamples.map(sample => ({
      run_id: sample.runId,
      profile_name: sample.profileName,
      task_id: sample.taskId,
      task_title: sample.taskTitle,
      repetition: sample.repetition,
    })),
    profiles: profileAnalyses,
    task_profiles: taskProfiles,
    decision,
  };
}
