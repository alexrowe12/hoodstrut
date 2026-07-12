---
id: add-feature-ai-judge
title: Add a greeting feature
repo: ./repos/todo-app
ai_judge: true
ai_judge_criteria: |
  The task is successful if:
  - A greeting function or feature was added to the codebase
  - The output indicates the assistant attempted the task
  - No major errors occurred during execution
difficulty: easy
tags: [feature, ai-judge-test]
---

## Description

Add a simple greeting feature to the application.

## Acceptance Criteria

- Add a function that returns a greeting message
- The greeting should include the time of day (morning/afternoon/evening)

## Notes

This task uses AI judge for success evaluation instead of a command or pattern.
