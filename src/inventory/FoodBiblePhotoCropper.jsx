import React, { useMemo, useRef } from "react";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export default function FoodBiblePhotoCropper({ src, crop, editing = false, onCropChange }) {
  const dragRef = useRef(null);
  const normalized = useMemo(() => ({
    x: Number.isFinite(Number(crop?.x)) ? Number(crop.x) : 50,
    y: Number.isFinite(Number(crop?.y)) ? Number(crop.y) : 50,
    zoom: Number.isFinite(Number(crop?.zoom)) ? Number(crop.zoom) : 1,
  }), [crop]);

  const startDrag = (event) => {
    if (!editing || !onCropChange) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      cropX: normalized.x,
      cropY: normalized.y,
      width: Math.max(1, event.currentTarget.clientWidth),
      height: Math.max(1, event.currentTarget.clientHeight),
    };
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !onCropChange) return;
    event.preventDefault();
    const zoom = Math.max(1, normalized.zoom);
    const sensitivity = 100 / zoom;
    const dx = ((event.clientX - drag.startX) / drag.width) * sensitivity;
    const dy = ((event.clientY - drag.startY) / drag.height) * sensitivity;
    onCropChange({
      x: clamp(drag.cropX - dx, 0, 100),
      y: clamp(drag.cropY - dy, 0, 100),
    });
  };

  const endDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  };

  const handleWheel = (event) => {
    if (!editing || !onCropChange) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    onCropChange({ zoom: clamp(Number((normalized.zoom + delta).toFixed(1)), 1, 3) });
  };

  return (
    <div
      className={`fb-card__photo-frame${editing ? " is-editing" : ""}`}
      data-testid="food-bible-photo-cropper"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={handleWheel}
      role={editing ? "application" : undefined}
      aria-label={editing ? "Drag photo to reposition. Use the zoom control or mouse wheel to zoom." : undefined}
    >
      <img
        src={src}
        alt=""
        className="fb-card__photo"
        data-testid="food-bible-card-photo"
        loading="lazy"
        decoding="async"
        draggable={false}
        style={{
          objectPosition: `${normalized.x}% ${normalized.y}%`,
          transform: `scale(${normalized.zoom})`,
        }}
      />
      {editing ? <span className="fb-card__photo-hint">Drag photo to reposition</span> : null}
    </div>
  );
}
