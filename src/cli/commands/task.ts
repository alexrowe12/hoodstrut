import { Command } from 'commander';
import chalk from 'chalk';
import { listTasks, loadTask, validateTask } from '../../core/task.js';

export const taskCommand = new Command('task')
  .description('Manage tasks');

taskCommand
  .command('list')
  .description('List all available tasks')
  .option('-d, --dir <directory>', 'Tasks directory', './tasks')
  .action(async (options) => {
    const tasks = await listTasks(options.dir);

    if (tasks.length === 0) {
      console.log(chalk.yellow('No tasks found.'));
      console.log(`Create tasks in ${options.dir}/ or run: hoodstrut init --with-examples`);
      return;
    }

    console.log(chalk.bold('Available tasks:\n'));
    for (const path of tasks) {
      try {
        const task = await loadTask(path);
        const difficulty = task.difficulty ? chalk.dim(`[${task.difficulty}]`) : '';
        console.log(`  ${chalk.green(task.id)} - ${task.title} ${difficulty}`);
        if (task.tags && task.tags.length > 0) {
          console.log(`    Tags: ${task.tags.join(', ')}`);
        }
      } catch {
        console.log(`  ${chalk.red(path)} - ${chalk.red('Invalid task')}`);
      }
    }
  });

taskCommand
  .command('show <id>')
  .description('Show details of a specific task')
  .option('-d, --dir <directory>', 'Tasks directory', './tasks')
  .action(async (id, options) => {
    const tasks = await listTasks(options.dir);
    const taskPath = tasks.find(t => t.includes(id));

    if (!taskPath) {
      console.error(chalk.red(`Task "${id}" not found`));
      process.exit(1);
    }

    try {
      const task = await loadTask(taskPath);
      console.log(chalk.bold(`Task: ${task.id}\n`));
      console.log(`Title: ${task.title}`);
      console.log(`Repository: ${task.repo}`);
      if (task.commit) {
        console.log(`Commit: ${task.commit} (immutable)`);
      } else {
        console.log(`Branch: ${task.branch} (mutable; resolved commit is recorded per run)`);
      }

      if (task.difficulty) {
        console.log(`Difficulty: ${task.difficulty}`);
      }

      console.log(`Verification: ${task.verification.type}`);
      const verificationCommand = task.verification.type === 'ai_judge'
        ? task.verification.evidence_command
        : task.verification.command;
      console.log(`Verification Command: ${verificationCommand}`);

      if (task.tags && task.tags.length > 0) {
        console.log(`Tags: ${task.tags.join(', ')}`);
      }

      console.log(`\n${chalk.bold('Description:')}\n${task.body}`);
    } catch (error) {
      console.error(chalk.red(`Error loading task: ${error}`));
      process.exit(1);
    }
  });

taskCommand
  .command('validate <path>')
  .description('Validate a task file')
  .action(async (path) => {
    const result = await validateTask(path);

    if (result.valid) {
      console.log(chalk.green(`Task is valid: ${path}`));
    } else {
      console.error(chalk.red(`Task is invalid: ${path}`));
      if (result.errors) {
        for (const error of result.errors) {
          console.error(error);
        }
      }
      process.exit(1);
    }
  });
