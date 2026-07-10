#!/bin/bash
set -e

TASK_PROMPT="$1"

# Run setup commands if provided (passed as JSON array in env)
if [ -n "$SETUP_COMMANDS" ] && [ "$SETUP_COMMANDS" != "[]" ]; then
  echo "=== Running setup commands ==="
  echo "$SETUP_COMMANDS" | jq -r '.[]' | while read -r cmd; do
    echo "$ $cmd"
    eval "$cmd"
  done
  echo "=== Setup complete ==="
fi

# Change to working directory if specified
if [ -n "$WORKING_DIR" ]; then
  cd "$WORKING_DIR"
fi

echo "=== Running Claude Code ==="

# Run Claude Code in single-shot print mode
# The --print flag runs Claude non-interactively with the given prompt
claude --print "$TASK_PROMPT"

CLAUDE_EXIT=$?

echo "=== Claude Code finished with exit code $CLAUDE_EXIT ==="

# Run success command if provided
if [ -n "$SUCCESS_COMMAND" ]; then
  echo "=== Running success command: $SUCCESS_COMMAND ==="
  eval "$SUCCESS_COMMAND"
  SUCCESS_EXIT=$?
  echo "=== Success command finished with exit code $SUCCESS_EXIT ==="
  exit $SUCCESS_EXIT
fi

exit $CLAUDE_EXIT
