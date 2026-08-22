import React, { useRef, useState } from "react";

export function normalizeHeroCrop(crop) {
  return {
    x: Number.isFinite(Number(crop?.x)) ? Number(crop.x) : 50,
    y: Number.isFinite(Number(crop?.y)) ? Number(crop.y) : 50,
    zoom: Number.isFinite(Number(crop?.zoom)) ? Number(crop.zoom) : 1,
    fit: crop?.fit === "fit" ? "fit" : "fill",
  };
}

export default function FoodBiblePhotoEditor({
  photo,
  crop,
  editing,
  busy,
  onCropChange,
  onUploadFile,
  onRemove,
  onReset,
}) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const normalized = normalizeHeroCrop(crop);
  const isFit = normalized.fit === "fit";

  const openPicker = () => inputRef.current?.click();

  const handleFiles = (files) => {
    const file = files?.[0];
    if (file) onUploadFile(file);
  };

  const onPointerDown = (event) => {
    if (!editing || !photo || isFit) return;
    if (event.button != null && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: normalized.x,
      originY: normalized.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
    setDragging(true);
  };

  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    onCropChange({
      x: Math.min(100, Math.max(0, drag.originX - dx)),
      y: Math.min(100, Math.max(0, drag.originY - dy)),
    });
  };

  const endDrag = (event) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDragging(false);
  };

  return (
    <div className="fb-photo" data-testid="food-bible-image-editor">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="fb-photo__file"
        data-testid="food-bible-image-upload"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {photo ? (
        <div
          className={`fb-photo__frame${isFit ? " is-fit" : " is-fill"}${dragging ? " is-dragging" : ""}`}
          data-testid="food-bible-card-photo-frame"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <img
            src={photo}
            alt=""
            className="fb-card__photo"
            data-testid="food-bible-card-photo"
            draggable={false}
            loading="lazy"
            decoding="async"
            style={{
              objectFit: isFit ? "contain" : "cover",
              objectPosition: `${normalized.x}% ${normalized.y}%`,
              transform: isFit ? "none" : `scale(${normalized.zoom || 1})`,
            }}
          />
        </div>
      ) : (
        <button
          type="button"
          className="fb-card__photo is-empty fb-photo__empty"
          data-testid="food-bible-card-photo-empty"
          onClick={editing ? openPicker : undefined}
          onDragOver={editing ? (event) => event.preventDefault() : undefined}
          onDrop={editing ? (event) => {
            event.preventDefault();
            handleFiles(event.dataTransfer?.files);
          } : undefined}
        >
          {editing ? (
            <>
              <strong>+ Add photo</strong>
              <span>Click to choose an image</span>
            </>
          ) : "No source photograph"}
        </button>
      )}
      {editing ? (
        <div className="fb-photo__controls">
          {photo ? (
            <>
              <button type="button" data-testid="food-bible-image-fit" className={isFit ? "is-active" : ""} onClick={() => onCropChange({ fit: "fit", zoom: 1 })}>
                Fit whole photo
              </button>
              <button type="button" data-testid="food-bible-image-fill" className={!isFit ? "is-active" : ""} onClick={() => onCropChange({ fit: "fill" })}>
                Fill frame
              </button>
              <label className="fb-photo__zoom">
                Zoom
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.1"
                  disabled={isFit}
                  value={normalized.zoom || 1}
                  data-testid="food-bible-image-zoom"
                  onChange={(event) => onCropChange({ zoom: Number(event.target.value), fit: "fill" })}
                />
              </label>
              <button type="button" data-testid="food-bible-image-reset" onClick={onReset}>Reset</button>
              <button type="button" data-testid="food-bible-image-replace" onClick={openPicker} disabled={busy === "image"}>
                {busy === "image" ? "Uploading…" : "Replace"}
              </button>
              <button type="button" data-testid="food-bible-image-remove" onClick={onRemove}>Remove</button>
            </>
          ) : (
            <button type="button" onClick={openPicker} disabled={busy === "image"}>
              {busy === "image" ? "Uploading…" : "Choose image"}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
