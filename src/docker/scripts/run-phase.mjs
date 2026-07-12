#!/usr/bin/env node

import { execSync, spawn } from 'node:child_process';

const phase = process.argv[2];
const workingDir = process.env.WORKING_DIR || '/workspace';

function run(command) {
  console.log(`$ ${command}`);
  try {
    execSync(command, { stdio: 'inherit', cwd: workingDir });
  } catch (error) {
    if (error && typeof error === 'object' && typeof error.status === 'number') {
      error.exitCode = error.status;
    }
    throw error;
  }
}

function runVerifier(command) {
  return new Promise((resolve, reject) => {
    console.log(`$ ${command}`);
    console.log('=== Verifier stdout ===');
    console.error('=== Verifier stderr ===');
    const child = spawn(command, { cwd: workingDir, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on('close', code => resolve(code ?? 1));
    child.on('error', reject);
  });
}

async function main() {
  if (phase === 'setup') {
    const commands = JSON.parse(process.env.SETUP_COMMANDS || '[]');
    if (!Array.isArray(commands) || commands.some(command => typeof command !== 'string')) {
      throw new Error('SETUP_COMMANDS must be a JSON array of strings');
    }

    console.log('=== Running setup commands ===');
    for (const command of commands) run(command);
    console.log('=== Setup complete ===');
  } else if (phase === 'verify') {
    const command = process.env.SUCCESS_COMMAND;
    if (!command) throw new Error('SUCCESS_COMMAND is required for verification');

    console.log('=== Running verifier ===');
    const exitCode = await runVerifier(command);
    console.log(`=== Verifier finished with exit code ${exitCode} ===`);
    process.exit(exitCode);
  } else {
    throw new Error(`Unknown phase: ${phase || '(missing)'}`);
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`=== ${phase || 'phase'} failed ===`);
  console.error(message);
  const exitCode = error && typeof error === 'object' && typeof error.exitCode === 'number'
    ? error.exitCode
    : 1;
  process.exit(exitCode);
});
