const { addTodo, listTodos, completeTodo } = require('./src/index.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

test('addTodo creates a todo', () => {
  const todo = addTodo('Test');
  assert(todo.text === 'Test');
  assert(todo.done === false);
});

test('listTodos returns todos', () => {
  const list = listTodos();
  assert(Array.isArray(list));
  assert(list.length > 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
