// File-based persistence for todos.
const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, '..', 'data', 'todos.json');

function loadTodos() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    // No file yet (or unreadable) — start empty.
    return [];
  }
}

function saveTodos(todos) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2));
}

module.exports = { loadTodos, saveTodos, DATA_FILE };
