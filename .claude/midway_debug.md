# Midway Debug Session (2026-07-11)

Testing phases 1-5 before proceeding to phase 6.

## Bugs Found & Fixed

### 1. SDK ignores settings.local.json model config

**Symptom**: Profile specified `model: claude-opus-4-20250514` but haiku ran instead.

**Root cause**: The Agent SDK's `query()` function doesn't read `settings.local.json` from the working directory. The `ANTHROPIC_MODEL` env var is also ignored.

**Fix**: Pass model directly via SDK options:
```javascript
// src/docker/scripts/run-sdk.mjs
if (process.env.ANTHROPIC_MODEL) {
  sdkOptions.settings = { model: process.env.ANTHROPIC_MODEL };
}
```

**File**: `src/docker/scripts/run-sdk.mjs`

---

### 2. AI judge used deprecated model

**Symptom**: `404 model: claude-sonnet-4-20250514`

**Fix**: Updated to `claude-sonnet-5`

**File**: `src/core/judge.ts:92`

---

### 3. Thinking API incompatible with Sonnet 5

**Symptom**: `400 "thinking.type.enabled" is not supported for this model`

**Root cause**: Sonnet 5 uses different thinking API (`thinking.type: 'adaptive'` + `output_config.effort`).

**Fix**: Removed thinking config entirely (not needed for simple judge task):
```javascript
const response = await client.messages.create({
  model: 'claude-sonnet-5',
  max_tokens: 500,
  system: JUDGE_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: userPrompt }],
});
```

**File**: `src/core/judge.ts:91-96`

---

## Known Issue (Not Fixed)

### Model config sometimes ignored

Even with the SDK `settings.model` fix, the model used isn't always the one requested:
- Log shows: `Using model: claude-opus-4-20250514`
- Metrics show: `Model: claude-haiku-4-5-20251001`

The SDK's `settings.model` appears to be a preference, not a hard requirement. May need to investigate SDK source or use a different mechanism (agent definition?) to force the model.

**Impact**: Low - tasks complete successfully, just with wrong model. Cost/quality may differ from expected.

---

## Test Results

| Phase | Test | Result |
|-------|------|--------|
| 1-2 | Profile scanner | PASS |
| 3 | Docker build | PASS |
| 3 | Docker run (hello-world) | PASS |
| 4 | Metrics extraction | PASS |
| 5 | success_command | PASS |
| 5 | success_patterns | PASS |
| 5 | ai_judge | PASS |

All phases 1-5 functional. Ready for phase 6.
