import React, { useEffect, useRef } from "react";
import { EGG_PREPARATIONS, DEFAULT_EGG_PREPARATION_ID } from "../lib/eggPreparation";

export default function EggPreparationPicker({
  selectedId = DEFAULT_EGG_PREPARATION_ID,
  isArabic = false,
  onSelect,
}) {
  const buttonRefs = useRef({});
  const groupRef = useRef(null);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return undefined;
    const stop = (event) => event.stopPropagation();
    node.addEventListener("pointerdown", stop);
    node.addEventListener("pointermove", stop);
    node.addEventListener("pointerup", stop);
    return () => {
      node.removeEventListener("pointerdown", stop);
      node.removeEventListener("pointermove", stop);
      node.removeEventListener("pointerup", stop);
    };
  }, []);

  useEffect(() => {
    EGG_PREPARATIONS.forEach((option) => {
      const preload = new Image();
      preload.decoding = "async";
      preload.src = option.image;
    });
  }, []);

  const moveSelection = (direction) => {
    const ids = EGG_PREPARATIONS.map((option) => option.id);
    const index = Math.max(0, ids.indexOf(selectedId));
    const nextIndex = (index + direction + ids.length) % ids.length;
    const nextId = ids[nextIndex];
    onSelect?.(nextId);
    buttonRefs.current[nextId]?.focus();
  };

  const onKeyDown = (event) => {
    const forward = isArabic ? "ArrowLeft" : "ArrowRight";
    const backward = isArabic ? "ArrowRight" : "ArrowLeft";
    if (event.key === forward || event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === backward || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    }
  };

  return (
      <div
      ref={groupRef}
      className="egg-prep"
      role="radiogroup"
      aria-label={isArabic ? "طريقة تحضير البيض" : "Egg preparation"}
      onKeyDown={onKeyDown}
    >
      {EGG_PREPARATIONS.map((option) => {
        const selected = option.id === selectedId;
        const label = isArabic ? option.ar : option.en;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            ref={(node) => {
              buttonRefs.current[option.id] = node;
            }}
            className={`egg-prep__option${selected ? " is-selected" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSelect?.(option.id)}
          >
            <img
              src={option.image}
              alt=""
              width="72"
              height="54"
              decoding="async"
            />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
