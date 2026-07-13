import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const vitest = new URL('../node_modules/vitest/vitest.mjs', import.meta.url);
const root = new URL('../', import.meta.url);
const tests = [
  'src/docker/__tests__/runner-image.integration.test.ts',
  'src/docker/__tests__/phase-classification.integration.test.ts',
];

const child = spawn(process.execPath, [fileURLToPath(vitest), 'run', ...tests], {
  cwd: fileURLToPath(root),
  env: { ...process.env, HOODSTRUT_DOCKER_TESTS: '1' },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Docker tests terminated by ${signal}`);
    process.exitCode = 1;
  } else {
    process.exitCode = code ?? 1;
  }
});
