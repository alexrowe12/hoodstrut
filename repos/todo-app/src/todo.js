// Pure todo helpers. No I/O — safe and easy to unit test.

function addTodo(todos, text) {
  const nextId = todos.length ? Math.max(...todos.map((t) => t.id)) + 1 : 1;
  const todo = { id: nextId, text, done: false };
  return [...todos, todo];
}

function completeTodo(todos, id) {
  return todos.map((t) => (t.id === id ? { ...t, done: true } : t));
}

module.exports = { addTodo, completeTodo };
