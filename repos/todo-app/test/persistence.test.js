const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { createStore } = require('../src/store');
const { DATA_FILE } = require('../src/storage');

test('todos persist across a simulated restart', () => {
  // Start from a clean slate.
  fs.rmSync(DATA_FILE, { force: true });

  const before = createStore();
  before.add('survive the restart');

  // Simulate a process restart: a brand-new store must reload from disk.
  const after = createStore();
  assert.ok(
    after.list().some((t) => t.text === 'survive the restart'),
    'expected the todo to persist across a restart, but it was lost'
  );
});
