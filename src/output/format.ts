/**
 * Shared value formatters used by every report surface (markdown + terminal).
 * Kept dependency-free so both the persisted `.md` and the colorized CLI
 * output speak the same units.
 */

export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins}m`;
}

export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatScore(value: number | null): string {
  return value === null ? '—' : Math.round(value).toLocaleString();
}

/** Ordinal medal used in the persisted markdown (renders everywhere). */
export function medal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '';
}
