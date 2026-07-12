// Stateful todo store. Loads existing todos from disk on creation so that
// todos survive a process restart.
const { loadTodos, saveTodos } = require('./storage');
const { addTodo, completeTodo } = require('./todo');

function createStore() {
  let todos = loadTodos();

  return {
    add(text) {
      todos = addTodo(todos, text);
      // BUG: the new todo lives only in memory — nothing is written to disk,
      // so it is lost the next time the app starts. Persist the change here.
      return todos[todos.length - 1];
    },
    complete(id) {
      todos = completeTodo(todos, id);
      // BUG: same problem — the completion is never persisted.
      return todos.find((t) => t.id === id);
    },
    list() {
      return todos;
    },
  };
}

module.exports = { createStore, saveTodos };
