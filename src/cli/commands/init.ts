import { Command } from 'commander';
import chalk from 'chalk';

export const initCommand = new Command('init')
  .description('Initialize a new hoodstrut setup')
  .option('--with-examples', 'Include example profiles, tasks, and repository')
  .action(async (_options) => {
    console.log(chalk.yellow('Init command not yet implemented (Phase 6)'));
    console.log('This will create default directories and optionally add example content.');
  });
