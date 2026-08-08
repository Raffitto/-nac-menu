import React, { useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import {
  containerDndId,
  itemDndId,
  parseItemDndId,
  parseSectionDndId,
  sectionDndId,
} from "../lib/menuManagerOrdering";

function collisionDetection(args) {
  const pointerHits = pointerWithin(args);
  if (pointerHits.length) return pointerHits;
  const rectHits = rectIntersection(args);
  if (rectHits.length) return rectHits;
  return closestCenter(args);
}

export function useMenuManagerDndSensors() {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 280, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
}

export function SectionFrame({
  sectionId,
  dndEnabled = true,
  className = "",
  children,
  header,
  label = "",
}) {
  if (!dndEnabled) {
    return (
      <div className={`mm-section ${className}`} data-testid={`sortable-section-${sectionId}`}>
        {header}
        {children}
      </div>
    );
  }
  return (
    <SortableSectionShell
      sectionId={sectionId}
      className={className}
      header={header}
      label={label}
    >
      {children}
    </SortableSectionShell>
  );
}

export function ItemFrame({
  itemId,
  sectionId,
  dndEnabled = true,
  className = "",
  label = "",
  onOpen,
  children,
}) {
  if (!dndEnabled) {
    return (
      <div
        className={`mm-item-card ${className}`}
        data-testid={`sortable-item-${itemId}`}
        onClick={onOpen}
      >
        {children}
      </div>
    );
  }
  return (
    <SortableItemShell
      itemId={itemId}
      sectionId={sectionId}
      className={className}
      label={label}
      onOpen={onOpen}
    >
      {children}
    </SortableItemShell>
  );
}

function SortableSectionShell({
  sectionId,
  disabled = false,
  className = "",
  children,
  header,
  label = "",
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id: sectionDndId(sectionId),
    disabled,
    data: { type: "section", sectionId, label },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mm-section ${className} ${isDragging ? "mm-section--dragging" : ""} ${isOver ? "mm-section--drop-target" : ""}`}
      data-testid={`sortable-section-${sectionId}`}
    >
      <div className={`mm-section-header-shell ${disabled ? "is-disabled" : ""}`}>
        {!disabled && (
          <button
            type="button"
            className="mm-section-drag-handle"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder section"
            title="Drag to reorder section"
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
        )}
        <div className="mm-section-header-main">{header}</div>
      </div>
      {children}
    </div>
  );
}

function SortableItemShell({
  itemId,
  sectionId,
  disabled = false,
  className = "",
  label = "",
  onOpen,
  children,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: itemDndId(itemId),
    disabled,
    data: { type: "item", itemId, sectionId, label },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mm-item-card mm-item-card--sortable ${className} ${isDragging ? "mm-item-card--dragging" : ""} ${disabled ? "mm-item-card--dnd-disabled" : ""}`}
      data-testid={`sortable-item-${itemId}`}
      {...(disabled ? {} : { ...attributes, ...listeners })}
      onClick={() => {
        if (!isDragging && onOpen) onOpen();
      }}
    >
      {!disabled && (
        <span className="mm-item-drag-hint" aria-hidden="true">
          <GripVertical size={12} />
        </span>
      )}
      {children}
    </div>
  );
}

export function MenuManagerDndProvider({
  disabled = false,
  sectionIds,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  activeDragLabel = null,
  children,
}) {
  const sensors = useMenuManagerDndSensors();
  const sortableSectionIds = useMemo(
    () => sectionIds.map((id) => sectionDndId(id)),
    [sectionIds],
  );

  if (disabled) {
    return <>{children}</>;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      autoScroll={{ threshold: { x: 0.12, y: 0.16 }, acceleration: 12 }}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <SortableContext items={sortableSectionIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {activeDragLabel ? (
          <div className="mm-drag-overlay-card">{activeDragLabel}</div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function SortableItemGrid({
  sectionId,
  itemIds,
  dndEnabled = true,
  children,
}) {
  if (!dndEnabled) {
    return (
      <div className="mm-item-grid" data-section-drop={sectionId}>
        {children}
      </div>
    );
  }

  return (
    <SortableItemGridActive sectionId={sectionId} itemIds={itemIds}>
      {children}
    </SortableItemGridActive>
  );
}

function SortableItemGridActive({ sectionId, itemIds, children }) {
  const sortableIds = useMemo(() => itemIds.map((id) => itemDndId(id)), [itemIds]);
  const { setNodeRef, isOver } = useDroppable({
    id: containerDndId(sectionId),
    data: { type: "container", sectionId },
  });

  return (
    <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
      <div
        ref={setNodeRef}
        className={`mm-item-grid ${isOver ? "mm-item-grid--drop-target" : ""}`}
        data-section-drop={sectionId}
      >
        {children}
      </div>
    </SortableContext>
  );
}

export function isolateInteractivePointer(event) {
  event.stopPropagation();
}

export { itemDndId, sectionDndId, parseItemDndId, parseSectionDndId, containerDndId };
