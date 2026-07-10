import { Command } from 'commander';
import chalk from 'chalk';

export const runCommand = new Command('run')
  .description('Execute a single profile against a single task')
  .requiredOption('-p, --profile <profile>', 'Profile name or path')
  .requiredOption('-t, --task <task>', 'Task ID or path')
  .option('-o, --output <directory>', 'Output directory for results')
  .option('-v, --verbose', 'Show detailed output')
  .action(async (_options) => {
    console.log(chalk.yellow('Run command not yet implemented (Phase 3)'));
    console.log('This will execute a profile against a task in a Docker container.');
  });
