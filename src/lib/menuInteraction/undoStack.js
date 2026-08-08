/** Bounded in-memory undo/redo stack for Menu Manager commands. */

export function createUndoStack(limit = 40) {
  return {
    past: [],
    future: [],
    limit,
  };
}

export function pushCommand(stack, command) {
  if (!command || typeof command.undo !== "function" || typeof command.redo !== "function") {
    return stack;
  }
  const past = [...stack.past, command];
  while (past.length > stack.limit) past.shift();
  return {
    ...stack,
    past,
    future: [],
  };
}

export async function undoCommand(stack) {
  if (!stack.past.length) return { stack, command: null };
  const command = stack.past[stack.past.length - 1];
  await command.undo();
  return {
    stack: {
      ...stack,
      past: stack.past.slice(0, -1),
      future: [command, ...stack.future],
    },
    command,
  };
}

export async function redoCommand(stack) {
  if (!stack.future.length) return { stack, command: null };
  const command = stack.future[0];
  await command.redo();
  return {
    stack: {
      ...stack,
      past: [...stack.past, command],
      future: stack.future.slice(1),
    },
    command,
  };
}
