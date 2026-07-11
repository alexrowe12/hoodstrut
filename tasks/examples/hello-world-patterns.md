---
id: hello-world-patterns
title: Create hello world with success patterns
repo: ./repos/todo-app
success_patterns:
  - "Hello.*World"
  - "created.*file"
  - "task complete"
difficulty: easy
tags: [hello-world, pattern-test]
---

## Description

Create a simple hello world file.

## Acceptance Criteria

- Create a file that outputs "Hello World"
- Output should indicate task completion

## Notes

This task uses regex pattern matching for success evaluation.
The patterns are case-insensitive and checked against stdout/stderr.
