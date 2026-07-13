import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function commandVersion(command, args = ['--version']) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function packageVersion(name) {
  return require(`/opt/hoodstrut/node_modules/${name}/package.json`).version;
}

function firstToken(value) {
  return value.split(/\s+/, 1)[0];
}

const runtime = {
  node: process.version.replace(/^v/, ''),
  npm: commandVersion('npm'),
  git: commandVersion('git').replace(/^git version\s+/, ''),
  python: commandVersion('python3').replace(/^Python\s+/, ''),
  claudeCode: firstToken(commandVersion('claude')),
  agentSdk: packageVersion('@anthropic-ai/claude-agent-sdk'),
  os: process.platform,
  architecture: process.arch,
};

process.stdout.write(`${JSON.stringify(runtime)}\n`);
