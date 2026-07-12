# todo-app

A tiny, dependency-free todo application used as an example repository for
[hoodstrut](../../README.md) benchmarking tasks.

## Structure

- `src/todo.js` — pure add/complete helpers (no I/O)
- `src/storage.js` — file-based persistence (`data/todos.json`)
- `src/store.js` — stateful store that loads from disk on startup
- `src/index.js` — entry point / demo
- `test/` — tests run with Node's built-in test runner

## Scripts

```bash
npm test     # node --test
npm start    # node src/index.js
```

The repo ships with a deliberate persistence bug (todos are not written to disk),
so `npm test` fails until it is fixed. See `tasks/examples/fix-todo-persistence.md`.
