import { useCallback, useMemo, useState } from "react";
import {
  clearSelection,
  createSelectionState,
  ensureSelectionIncludes,
  selectAllVisible,
  selectRange,
  selectSingle,
  selectionCount,
  toggleSelect,
} from "../../lib/menuInteraction/selectionModel";
import { isModKey } from "../../lib/menuInteraction/platform";

export default function useMenuSelection() {
  const [selection, setSelection] = useState(() => createSelectionState());

  const selectedSet = useMemo(() => new Set(selection.selectedIds), [selection.selectedIds]);
  const count = selectionCount(selection);

  const clear = useCallback(() => setSelection(clearSelection()), []);

  const selectOnly = useCallback((itemId) => {
    setSelection(selectSingle({}, itemId));
  }, []);

  const handleItemPointerSelect = useCallback((event, itemId, sections) => {
    if (event?.shiftKey) {
      setSelection((prev) =>
        selectRange(prev, sections, itemId, {
          additive: isModKey(event),
        }),
      );
      return;
    }
    if (isModKey(event)) {
      setSelection((prev) => toggleSelect(prev, itemId));
      return;
    }
    setSelection(selectSingle({}, itemId));
  }, []);

  const selectAll = useCallback((sections) => {
    setSelection(selectAllVisible(sections));
  }, []);

  const ensureIncludes = useCallback((itemId) => {
    setSelection((prev) => ensureSelectionIncludes(prev, itemId));
  }, []);

  const isSelected = useCallback((itemId) => selectedSet.has(itemId), [selectedSet]);

  return {
    selection,
    selectedIds: selection.selectedIds,
    selectedSet,
    count,
    focusId: selection.focusId,
    clear,
    selectOnly,
    selectAll,
    ensureIncludes,
    handleItemPointerSelect,
    isSelected,
    setSelection,
  };
}
