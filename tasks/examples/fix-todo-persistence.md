---
id: fix-todo-persistence
title: Todos don't persist after restart
repo: ./repos/todo-app
verification:
  type: command
  command: npm test
difficulty: easy
tags: [bugfix, storage]
---

## Description

Users report that their todos disappear when the server restarts.

## Acceptance Criteria

- Todos should persist between server restarts
- Existing tests should pass
- No data loss on restart

## Notes

Check the storage implementation. The data might not be getting saved to disk properly.
