const { createStore } = require('./store');

if (require.main === module) {
  const store = createStore();
  console.log('Todo App');
  store.add('Example todo');
  console.log(store.list());
}

module.exports = { createStore };
