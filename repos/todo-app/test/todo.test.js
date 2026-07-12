const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { addTodo, completeTodo } = require('../src/todo');
const { createStore } = require('../src/store');
const { DATA_FILE } = require('../src/storage');

test('addTodo appends a todo with an incrementing id', () => {
  let todos = [];
  todos = addTodo(todos, 'first');
  todos = addTodo(todos, 'second');
  assert.strictEqual(todos.length, 2);
  assert.strictEqual(todos[1].id, 2);
  assert.strictEqual(todos[1].done, false);
});

test('completeTodo marks the matching todo done', () => {
  let todos = addTodo([], 'task');
  todos = completeTodo(todos, 1);
  assert.strictEqual(todos[0].done, true);
});

test('store add then list returns the todo within one session', () => {
  fs.rmSync(DATA_FILE, { force: true });
  const store = createStore();
  store.add('buy milk');
  assert.ok(store.list().some((t) => t.text === 'buy milk'));
});
