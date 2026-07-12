---
id: hello-world-patterns
title: Create hello world with success patterns
repo: ./repos/todo-app
verification:
  type: pattern
  command: node hello.js
  patterns:
    - "^Hello.*World!?$"
  match: all
difficulty: easy
tags: [hello-world, pattern-test]
---

## Description

Create a simple hello world file.

## Acceptance Criteria

- Create a file that outputs "Hello World"
- Output should indicate task completion

## Notes

This task matches a regex against the output produced by `node hello.js`.
Assistant conversation is never used as verification evidence.
