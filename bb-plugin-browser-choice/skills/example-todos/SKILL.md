---
name: example-todos
description: Read and update the Browser Choice plugin's example todo list with the `bb browser-choice` CLI. Use when the user asks to add, complete, reopen, remove, or review todos, or when the steps of a task should be tracked as todos.
---

# Example todos

The Browser Choice plugin keeps one todo list. The Example todos page in the BB sidebar and
the `bb browser-choice` command read and write the same list, so a change from either
side shows in the other at once.

## Commands

| Command | Effect |
| --- | --- |
| `bb browser-choice list` | Show every todo with its id. `[x]` marks a done todo. |
| `bb browser-choice add <title>` | Add a todo. Quote a title that has spaces. |
| `bb browser-choice done <todo-id>` | Mark a todo done. |
| `bb browser-choice undo <todo-id>` | Mark a todo not done. |
| `bb browser-choice remove <todo-id>` | Delete a todo. |

Add `--json` to any command when the output drives code.

## Procedure

1. Run `bb browser-choice list` before you change the list. Use the ids it prints;
   never guess an id.
2. Add todos one at a time with a short title that starts with a verb:
   `bb browser-choice add "Write the release notes"`.
3. When you finish a todo, mark it done: `bb browser-choice done <todo-id>`. Do not
   remove a todo to mark it done.
4. Remove a todo only when the user asks for it or when it duplicates
   another todo.
5. End with a short summary of what you added, completed, or removed.

## Rules

- Change the list only through `bb browser-choice`. Do not edit bb.db or the plugin's
  storage directly.
- A non-zero exit with "No todo with id" means the id is stale: run
  `bb browser-choice list` again.
