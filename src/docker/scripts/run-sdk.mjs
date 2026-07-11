#!/usr/bin/env node
/**
 * Container entrypoint that uses the Agent SDK to run Claude Code
 * and outputs metrics to a JSON file for the host to parse.
 *
 * Usage: node run-sdk.mjs <task-prompt>
 *
 * Environment variables:
 * - SETUP_COMMANDS: JSON array of setup commands to run first
 * - SUCCESS_COMMAND: Command to run after Claude Code to verify success
 * - WORKING_DIR: Working directory for Claude Code
 * - METRICS_FILE: Path to write metrics JSON (default: /workspace/.metrics.json)
 * - All OTEL_* and CLAUDE_* env vars are passed through
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

async function main() {
  const taskPrompt = process.argv[2];

  if (!taskPrompt) {
    console.error('Usage: run-sdk.mjs <task-prompt>');
    process.exit(1);
  }

  const setupCommands = process.env.SETUP_COMMANDS;
  const successCommand = process.env.SUCCESS_COMMAND;
  const workingDir = process.env.WORKING_DIR || '/workspace';
  const metricsFile = process.env.METRICS_FILE || '/workspace/.metrics.json';

  // Run setup commands if provided
  if (setupCommands && setupCommands !== '[]') {
    console.log('=== Running setup commands ===');
    try {
      const commands = JSON.parse(setupCommands);
      for (const cmd of commands) {
        console.log(`$ ${cmd}`);
        execSync(cmd, { stdio: 'inherit', cwd: workingDir });
      }
      console.log('=== Setup complete ===');
    } catch (error) {
      console.error('Setup failed:', error);
      process.exit(1);
    }
  }

  // Change to working directory
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

    const sdkOptions = {
      cwd: workingDir,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    };

    // Pass model from env if specified
    if (process.env.ANTHROPIC_MODEL) {
      sdkOptions.settings = { model: process.env.ANTHROPIC_MODEL };
      console.log(`Using model: ${process.env.ANTHROPIC_MODEL}`);
    }

    const stream = query({
      prompt: taskPrompt,
      options: sdkOptions,
    });

    for await (const message of stream) {
      if (message.type === 'assistant') {
        // Print assistant output
        if (message.content) {
          process.stdout.write(message.content);
        } else if (message.message?.content) {
          for (const block of message.message.content) {
            if (block.type === 'text' && block.text) {
              process.stdout.write(block.text);
            }
          }
        }

        // Count turns (dedupe by message ID)
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
          const models = Object.keys(message.modelUsage);
          metrics.model = models[0] || 'unknown';

          for (const [model, usage] of Object.entries(message.modelUsage)) {
            metrics.model_usage[model] = {
              input_tokens: usage.inputTokens,
              output_tokens: usage.outputTokens,
              cache_read_tokens: usage.cacheReadInputTokens,
              cache_write_tokens: usage.cacheCreationInputTokens,
              cost_usd: usage.costUSD,
            };
          }
        }
      }
    }
  } catch (error) {
    metrics.error = error instanceof Error ? error.message : String(error);
    console.error('\nClaude Code error:', metrics.error);
  }

  metrics.duration_ms = Date.now() - startTime;
  console.log(`\n=== Claude Code finished in ${metrics.duration_ms}ms ===`);

  // Write metrics file
  writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
  console.log(`Metrics written to ${metricsFile}`);

  // Run success command if provided
  let successExit = 0;
  if (successCommand) {
    console.log(`=== Running success command: ${successCommand} ===`);
    try {
      execSync(successCommand, { stdio: 'inherit', cwd: workingDir });
      console.log('=== Success command passed ===');
    } catch {
      console.log('=== Success command failed ===');
      successExit = 1;
    }
  }

  // Exit with appropriate code
  const finalExit = successCommand ? successExit : (metrics.success ? 0 : 1);
  process.exit(finalExit);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
