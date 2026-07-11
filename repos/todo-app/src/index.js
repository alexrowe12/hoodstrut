const todos = [];

function addTodo(text) {
  todos.push({ id: todos.length + 1, text, done: false });
  return todos[todos.length - 1];
}

function listTodos() {
  return todos;
}

function completeTodo(id) {
  const todo = todos.find(t => t.id === id);
  if (todo) todo.done = true;
  return todo;
}

module.exports = { addTodo, listTodos, completeTodo };

if (require.main === module) {
  console.log("Todo App running");
  addTodo("Test todo");
  console.log(listTodos());
}
