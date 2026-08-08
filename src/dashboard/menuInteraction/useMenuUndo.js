import { useCallback, useRef, useState } from "react";
import {
  createUndoStack,
  pushCommand,
  redoCommand,
  undoCommand,
} from "../../lib/menuInteraction/undoStack";

export default function useMenuUndo({ onToast } = {}) {
  const stackRef = useRef(createUndoStack());
  const [, bump] = useState(0);

  const refresh = useCallback(() => bump((n) => n + 1), []);

  const push = useCallback(
    (command) => {
      stackRef.current = pushCommand(stackRef.current, command);
      refresh();
      if (command?.label && onToast) {
        onToast(`${command.label} · Undo`, "success", { undoable: true });
      }
    },
    [onToast, refresh],
  );

  const undo = useCallback(async () => {
    const result = await undoCommand(stackRef.current);
    stackRef.current = result.stack;
    refresh();
    if (result.command?.label && onToast) onToast(`Undid: ${result.command.label}`);
    return result.command;
  }, [onToast, refresh]);

  const redo = useCallback(async () => {
    const result = await redoCommand(stackRef.current);
    stackRef.current = result.stack;
    refresh();
    if (result.command?.label && onToast) onToast(`Redid: ${result.command.label}`);
    return result.command;
  }, [onToast, refresh]);

  return {
    canUndo: stackRef.current.past.length > 0,
    canRedo: stackRef.current.future.length > 0,
    push,
    undo,
    redo,
  };
}
