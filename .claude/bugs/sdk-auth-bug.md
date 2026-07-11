# Bug: Agent SDK fails to authenticate despite API key being present

> **RESOLVED (2026-07-11).** This was never an auth bug. The SDK's
> `permissionMode: 'bypassPermissions'` makes the spawned CLI run with
> `--dangerously-skip-permissions`, which Claude Code refuses under root:
> `--dangerously-skip-permissions cannot be used with root/sudo privileges
> for security reasons`. The `node:20-slim` container runs as root, so the
> CLI exited 1 before authenticating — surfaced misleadingly as
> `apiKeySource: "none"` / "Not logged in". The direct-CLI repro "worked"
> only because it didn't pass that flag. Fix: `ENV IS_SANDBOX=1` in
> `Dockerfile.runner` (Claude Code's escape hatch for sandboxed root
> containers). The failing CLI stderr was captured via the SDK's
> `options.stderr` callback, which is how to debug this class of failure.

## Summary

The `@anthropic-ai/claude-agent-sdk` fails to authenticate inside a Docker container, even though:
1. `ANTHROPIC_API_KEY` is correctly passed to the container
2. Direct CLI `claude --print 'Say hello'` works perfectly
3. `CLAUDE_CODE_SIMPLE=1` is set (forces API key auth only)

## Symptoms

- SDK returns `apiKeySource: "none"` in the init message
- Claude Code responds with "Not logged in · Please run /login"
- Process exits with code 1

## Environment

- Container: `node:20-slim` based
- Claude Code: v2.1.207 (installed via `npm install -g @anthropic-ai/claude-code`)
- Agent SDK: v0.3.207 (installed via `npm install -g @anthropic-ai/claude-agent-sdk`)
- API key: Valid, starts with `sk-ant-api03-...`

## Reproduction

### Works (direct CLI):
```bash
docker run --rm -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -e CLAUDE_CODE_SIMPLE=1 \
  --entrypoint bash hoodstrut-runner:latest \
  -c "claude --print 'Say hi'"
# Output: Hi! 👋 How can I help you today?
```

### Fails (SDK):
```bash
docker run --rm -e ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY -e CLAUDE_CODE_SIMPLE=1 \
  --entrypoint bash hoodstrut-runner:latest \
  -c "node --experimental-vm-modules -e \"
import('@anthropic-ai/claude-agent-sdk').then(async ({ query }) => {
  const stream = query({ 
    prompt: 'Say hi briefly',
    options: { 
      env: process.env,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true 
    }
  });
  for await (const msg of stream) {
    console.log(JSON.stringify(msg));
  }
});
\""
# Output includes: "apiKeySource":"none"
# Fails with: Not logged in · Please run /login
```

## SDK init message (shows apiKeySource: "none"):
```json
{
  "type": "system",
  "subtype": "init",
  "apiKeySource": "none",
  "model": "claude-opus-4-8[1m]",
  "permissionMode": "default"
}
```

## Key observation

The SDK spawns Claude Code with these args (from minified source):
```
--output-format stream-json --verbose --input-format stream-json
```

The direct CLI uses `--print` mode. Something about the stream-json mode doesn't pick up the API key from the environment.

## Hypothesis

The SDK may be:
1. Spawning Claude Code in a way that doesn't inherit env vars correctly
2. Using a mode that requires OAuth rather than API key
3. Having the `env` option override vs merge incorrectly

## Files involved

- `/Users/alexrowe/Desktop/hoodstrut/src/docker/scripts/run-sdk.mjs` - Container entrypoint using SDK
- `/Users/alexrowe/Desktop/hoodstrut/src/docker/templates/Dockerfile.runner` - Container definition

## Current run-sdk.mjs relevant code:
```javascript
const stream = query({
  prompt: taskPrompt,
  options: {
    cwd: workingDir,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
  },
});
```

## Things tried that didn't work

1. `env: process.env` - explicitly passing environment
2. `env: { ...process.env, CLAUDE_CODE_SIMPLE: '1' }` - spreading with SIMPLE flag
3. `CLAUDE_CODE_SIMPLE=1` as container env var
4. Various combinations of permissionMode options

## Potential fixes to investigate

1. Check if SDK has an `apiKey` option to pass directly
2. Check if there's a different auth mode for SDK
3. Look at SDK source for how it spawns Claude Code subprocess
4. Try using the SDK's `pathToClaudeCodeExecutable` option
5. Check if there's a required login/auth step before SDK can work

## SDK Type Definitions (relevant parts)

From `/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:
```typescript
env?: {
  [envVar: string]: string | undefined;
};
// When set, this value REPLACES the subprocess environment entirely — it is
// not merged with process.env. Spread process.env yourself if the
// subprocess still needs inherited variables like PATH, HOME, or
// ANTHROPIC_API_KEY. When omitted, the subprocess inherits process.env.
```

## Success criteria

The SDK should:
1. Show `apiKeySource: "env"` or similar in init message
2. Successfully make API calls
3. Return actual Claude responses instead of "Not logged in"
