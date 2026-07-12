---
id: add-due-dates
title: Add due date support to todos
repo: ./repos/todo-app
verification:
  type: ai_judge
  evidence_command: node --test test/todo.test.js
  criteria: |
    The task is successful if:
    - Todos can carry an optional due date (e.g. a `due` field on the todo object)
    - The change is wired through the store/API, not just an unused helper
    - Existing todo behavior (add/list/complete) is preserved
difficulty: medium
tags: [feature, ai-judge]
---

## Description

Product wants due dates on todos so users can track deadlines.

## Acceptance Criteria

- Todos can have an optional due date
- Users can list or filter todos by due date
- Existing functionality keeps working

## Notes

This task uses the AI judge for success evaluation instead of a command,
since "add a feature well" is hard to capture in a single exit code.
