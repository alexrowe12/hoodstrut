#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REFERENCE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;

export function resolveReferences(value, env, context = 'profile value') {
  if (typeof value === 'string') {
    return value.replace(REFERENCE_PATTERN, (_, name, fallback) => {
      const resolved = env[name] ?? fallback;
      if (resolved === undefined) throw new Error(`${context} requires environment variable ${name}`);
      return resolved;
    });
  }
  if (Array.isArray(value)) return value.map(item => resolveReferences(item, env, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      resolveReferences(item, env, `${context}.${key}`),
    ]));
  }
  return value;
}

export function buildSdkOptions(profile, workingDir, env = process.env) {
  const options = {
    cwd: workingDir,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    model: profile.model,
    effort: profile.effort,
    systemPrompt: profile.systemPrompt
      ? { type: 'preset', preset: 'claude_code', append: profile.systemPrompt }
      : { type: 'preset', preset: 'claude_code' },
    tools: { type: 'preset', preset: 'claude_code' },
    settingSources: ['user', 'project', 'local'],
  };
  if (profile.maxTurns !== undefined) options.maxTurns = profile.maxTurns;
  if (profile.allowedTools !== undefined) options.allowedTools = profile.allowedTools;
  if (profile.disallowedTools !== undefined) options.disallowedTools = profile.disallowedTools;
  if (profile.mcpServers !== undefined) {
    options.mcpServers = resolveReferences(profile.mcpServers, env, 'mcpServers');
  }
  return options;
}

export async function runAgent({ taskPrompt, profile, workingDir, metricsFile, query }) {
  process.chdir(workingDir);
  console.log('=== Running Claude Code via SDK ===');
  const startTime = Date.now();
  const metrics = {
    success: false,
    cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    turns: 0,
    model: 'unknown',
    model_usage: {},
    duration_ms: 0,
    error: null,
  };

  try {
    const seenMessageIds = new Set();
    const stream = query({ prompt: taskPrompt, options: buildSdkOptions(profile, workingDir) });
    for await (const message of stream) {
      if (message.type === 'assistant') {
        if (message.content) process.stdout.write(message.content);
        else if (message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text) process.stdout.write(block.text);
          }
        }
        if (message.message?.id && !seenMessageIds.has(message.message.id)) {
          seenMessageIds.add(message.message.id);
          metrics.turns++;
        }
      }
      if (message.type === 'result') {
        metrics.success = message.subtype !== 'error';
        metrics.cost_usd = message.total_cost_usd || 0;
        if (message.usage) {
          metrics.input_tokens = message.usage.input_tokens || 0;
          metrics.output_tokens = message.usage.output_tokens || 0;
          metrics.cache_read_tokens = message.usage.cache_read_input_tokens || 0;
          metrics.cache_write_tokens = message.usage.cache_creation_input_tokens || 0;
        }
        if (message.modelUsage) {
          for (const [model, usage] of Object.entries(message.modelUsage)) {
            metrics.model_usage[model] = {
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              cache_read_tokens: usage.cacheReadInputTokens,
              cache_write_tokens: usage.cacheCreationInputTokens,
              cost_usd: usage.costUSD,
            };
          }
          metrics.model = Object.entries(metrics.model_usage)
            .sort(([, a], [, b]) => b.cost_usd - a.cost_usd)[0]?.[0] ?? 'unknown';
        }
      }
    }
  } catch (error) {
    metrics.error = error instanceof Error ? error.message : String(error);
    console.error('\nClaude Code error:', metrics.error);
  }

  metrics.duration_ms = Date.now() - startTime;
  console.log(`\n=== Claude Code finished in ${metrics.duration_ms}ms ===`);
  writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
  return metrics.success ? 0 : 1;
}

async function main() {
  const taskPrompt = process.argv[2];
  if (!taskPrompt) throw new Error('Usage: run-sdk.mjs <task-prompt>');
  const workingDir = process.env.WORKING_DIR || '/workspace';
  const metricsFile = process.env.METRICS_FILE || '/hoodstrut-artifacts/metrics.json';
  const profilePath = process.env.PROFILE_CONFIG_FILE || '/root/.claude/hoodstrut-profile.json';
  const profile = JSON.parse(readFileSync(profilePath, 'utf-8'));
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  process.exitCode = await runAgent({ taskPrompt, profile, workingDir, metricsFile, query });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exitCode = 1;
  });
}
