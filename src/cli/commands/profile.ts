import { Command } from 'commander';
import chalk from 'chalk';
import { listProfiles, loadProfile, validateProfile } from '../../core/profile.js';
import {
  scanClaudeConfig,
  generateProfileFromScan,
  writeGeneratedProfile,
} from '../../scanner/index.js';

export const profileCommand = new Command('profile')
  .description('Manage profiles');

profileCommand
  .command('list')
  .description('List all available profiles')
  .option('-d, --dir <directory>', 'Profiles directory', './profiles')
  .action(async (options) => {
    const profiles = await listProfiles(options.dir);

    if (profiles.length === 0) {
      console.log(chalk.yellow('No profiles found.'));
      console.log(`Create profiles in ${options.dir}/ or run: hoodstrut profile scan`);
      return;
    }

    console.log(chalk.bold('Available profiles:\n'));
    for (const path of profiles) {
      try {
        const profile = await loadProfile(path);
        console.log(`  ${chalk.green(profile.name)} - ${profile.description || 'No description'}`);
        console.log(`    Model: ${profile.model}, Effort: ${profile.effort}`);
      } catch {
        console.log(`  ${chalk.red(path)} - ${chalk.red('Invalid profile')}`);
      }
    }
  });

profileCommand
  .command('show <name>')
  .description('Show details of a specific profile')
  .option('-d, --dir <directory>', 'Profiles directory', './profiles')
  .action(async (name, options) => {
    const profiles = await listProfiles(options.dir);
    const profilePath = profiles.find(p => p.includes(name));

    if (!profilePath) {
      console.error(chalk.red(`Profile "${name}" not found`));
      process.exit(1);
    }

    try {
      const profile = await loadProfile(profilePath);
      console.log(chalk.bold(`Profile: ${profile.name}\n`));
      console.log(`Description: ${profile.description || 'None'}`);
      console.log(`Model: ${profile.model}`);
      console.log(`Effort: ${profile.effort}`);

      if (profile.system_prompt) {
        console.log(`\nSystem Prompt:\n${profile.system_prompt}`);
      }

      if (profile.settings) {
        console.log(`\nRuntime Settings:`);
        if (profile.settings.timeout) console.log(`  Timeout: ${profile.settings.timeout}s`);
        if (profile.settings.max_turns) console.log(`  Max turns: ${profile.settings.max_turns}`);
        if (profile.settings.allowed_tools?.length) {
          console.log(`  Allowed tools: ${profile.settings.allowed_tools.join(', ')}`);
        }
        if (profile.settings.disallowed_tools?.length) {
          console.log(`  Disallowed tools: ${profile.settings.disallowed_tools.join(', ')}`);
        }
      }

      if (profile.mcp_servers && profile.mcp_servers.length > 0) {
        console.log(`\nMCP Servers:`);
        for (const server of profile.mcp_servers) {
          console.log(`  - ${server.name}: ${server.command}`);
        }
      }

      if (profile.skills && profile.skills.length > 0) {
        console.log(`\nSkills:`);
        for (const skill of profile.skills) {
          console.log(`  - ${skill.name}`);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Error loading profile: ${error}`));
      process.exit(1);
    }
  });

profileCommand
  .command('validate <path>')
  .description('Validate a profile file')
  .action(async (path) => {
    const result = await validateProfile(path);

    if (result.valid) {
      console.log(chalk.green(`Profile is valid: ${path}`));
    } else {
      console.error(chalk.red(`Profile is invalid: ${path}`));
      if (result.errors) {
        for (const error of result.errors) {
          console.error(error);
        }
      }
      process.exit(1);
    }
  });

profileCommand
  .command('scan')
  .description('Scan and import existing Claude Code configuration')
  .option('-n, --name <name>', 'Name for the generated profile')
  .option('-p, --path <path>', 'Exact user config directory or project root')
  .option('-o, --output <directory>', 'Output directory for generated profile', './profiles')
  .option('--project', 'Scan only project configuration (cwd unless --path is set)')
  .option('--dry-run', 'Show what would be extracted without writing')
  .option('--validate', 'Validate the generated profile after creation')
  .action(async (options) => {
    try {
      console.log(chalk.blue('Scanning Claude Code configuration...\n'));

      if (options.dryRun) {
        const scanResult = await scanClaudeConfig({
          path: options.path,
          project: options.project,
        });

        console.log(chalk.bold('Scan Results:\n'));
        console.log(`Source: ${scanResult.sourcePath}\n`);

        console.log(chalk.bold('Settings:'));
        if (scanResult.settings.merged.model) {
          console.log(`  Model: ${scanResult.settings.merged.model}`);
        }
        if (scanResult.settings.merged.effortLevel) {
          console.log(`  Effort: ${scanResult.settings.merged.effortLevel}`);
        }
        if (!scanResult.settings.merged.model && !scanResult.settings.merged.effortLevel) {
          console.log('  (none found)');
        }
        if (scanResult.settings.merged.permissions?.allow?.length) {
          console.log(`  Allowed tools: ${scanResult.settings.merged.permissions.allow.join(', ')}`);
        }
        if (scanResult.settings.merged.permissions?.deny?.length) {
          console.log(`  Disallowed tools: ${scanResult.settings.merged.permissions.deny.join(', ')}`);
        }

        console.log(chalk.bold('\nMCP Servers:'));
        if (scanResult.mcpServers.servers.length > 0) {
          for (const server of scanResult.mcpServers.servers) {
            console.log(`  - ${server.name}: ${server.command || server.url || '(no command)'}`);
          }
        } else {
          console.log('  (none found)');
        }

        console.log(chalk.bold('\nSystem Prompt (CLAUDE.md):'));
        if (scanResult.prompt) {
          const preview = scanResult.prompt.content.slice(0, 100);
          console.log(`  ${preview}${scanResult.prompt.content.length > 100 ? '...' : ''}`);
        } else {
          console.log('  (none found)');
        }

        console.log(chalk.bold('\nSkills:'));
        if (scanResult.skills.length > 0) {
          for (const skill of scanResult.skills) {
            console.log(`  - ${skill.name}: ${skill.description || '(no description)'}`);
          }
        } else {
          console.log('  (none found)');
        }

        console.log(chalk.bold('\nEnvironment Variables:'));
        const envVars = new Set([
          ...scanResult.env.claudeCodeVars,
          ...scanResult.mcpServers.requiredEnvVars,
        ]);
        if (envVars.size > 0) {
          for (const varName of [...envVars].sort()) {
            console.log(`  - ${varName}`);
          }
        } else {
          console.log('  (none found)');
        }

        for (const warning of scanResult.mcpServers.warnings) {
          console.log(chalk.yellow(`  Warning: ${warning}`));
        }

        console.log(chalk.yellow('\n(dry-run mode - no files written)'));
        return;
      }

      const generated = await generateProfileFromScan({
        path: options.path,
        project: options.project,
        name: options.name,
      });

      const outputPath = await writeGeneratedProfile(generated, options.output);

      console.log(chalk.green(`Profile created: ${outputPath}\n`));

      console.log(chalk.bold('Profile Summary:'));
      const { profile, requiredEnvVars, warnings } = generated;
      console.log(`  Name: ${profile.name}`);
      console.log(`  Model: ${profile.model}`);
      console.log(`  Effort: ${profile.effort}`);
      if (profile.mcp_servers?.length) {
        console.log(`  MCP Servers: ${profile.mcp_servers.length}`);
      }
      if (profile.skills?.length) {
        console.log(`  Skills: ${profile.skills.length}`);
      }
      if (profile.system_prompt) {
        console.log(`  System Prompt: ${profile.system_prompt.length} characters`);
      }
      if (profile.settings?.allowed_tools?.length) {
        console.log(`  Allowed Tools: ${profile.settings.allowed_tools.join(', ')}`);
      }
      if (profile.settings?.disallowed_tools?.length) {
        console.log(`  Disallowed Tools: ${profile.settings.disallowed_tools.join(', ')}`);
      }
      if (requiredEnvVars.length > 0) {
        console.log(`  Required environment: ${requiredEnvVars.join(', ')}`);
      }
      for (const warning of warnings) {
        console.log(chalk.yellow(`  Warning: ${warning}`));
      }

      if (options.validate) {
        console.log('\nValidating generated profile...');
        const result = await validateProfile(outputPath);
        if (result.valid) {
          console.log(chalk.green('Profile is valid.'));
        } else {
          console.error(chalk.red('Profile validation failed:'));
          result.errors?.forEach(e => console.error(`  ${e}`));
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(chalk.red(`Scan failed: ${error}`));
      process.exit(1);
    }
  });
