#!/usr/bin/env node
import { Command } from 'commander';
import { profileCommand } from './commands/profile.js';
import { taskCommand } from './commands/task.js';
import { runCommand } from './commands/run.js';
import { benchmarkCommand } from './commands/benchmark.js';
import { reportCommand } from './commands/report.js';
import { initCommand } from './commands/init.js';

const program = new Command();

program
  .name('hoodstrut')
  .description('Benchmark LLM coding assistants with reproducible, isolated test runs')
  .version('0.1.0');

program.addCommand(profileCommand);
program.addCommand(taskCommand);
program.addCommand(runCommand);
program.addCommand(benchmarkCommand);
program.addCommand(reportCommand);
program.addCommand(initCommand);

program.parse();
