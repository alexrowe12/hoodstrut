#!/usr/bin/env node
import { Command } from 'commander';
import { profileCommand } from './commands/profile.js';
import { taskCommand } from './commands/task.js';
import { runCommand } from './commands/run.js';
import { benchmarkCommand } from './commands/benchmark.js';
import { reportCommand } from './commands/report.js';
import { initCommand } from './commands/init.js';
import { loadPackageMetadata } from './package-metadata.js';

const program = new Command();
const packageMetadata = loadPackageMetadata();

program
  .name(packageMetadata.name)
  .description('Benchmark LLM coding assistants with reproducible, isolated test runs')
  .version(packageMetadata.version);

program.addCommand(profileCommand);
program.addCommand(taskCommand);
program.addCommand(runCommand);
program.addCommand(benchmarkCommand);
program.addCommand(reportCommand);
program.addCommand(initCommand);

program.parse();
