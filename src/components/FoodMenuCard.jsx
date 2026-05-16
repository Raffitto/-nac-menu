import React, { useRef, useState, lazy, Suspense } from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import ImpressionTracked from "./ImpressionTracked";
import { trackImageExpand } from "../lib/imageExpand";

const ImageLightbox = lazy(() => import("./ImageLightbox"));
const LONG_PRESS_MS = 520;

export default function FoodMenuCard({
  menuItem,
  categoryId,
  sectionTitleEn,
  sectionIndex,
  itemIndex,
  language,
  isArabic,
  enabled,
  onOpenItem,
  variants,
}) {
  const [lightbox, setLightbox] = useState(false);
  const longPressTimer = useRef(null);

  const openLightbox = () => {
    trackImageExpand({
      categoryId,
      sectionTitleEn,
      menuItem,
      language,
    });
    setLightbox(true);
  };

  const handleExpandClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    openLightbox();
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleTouchStart = (e) => {
    e.stopPropagation();
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      openLightbox();
    }, LONG_PRESS_MS);
  };

  return (
    <>
      <ImpressionTracked
        layoutId={`card-${categoryId}-${menuItem.en}`}
        className="menu-card menu-card-compact"
        categoryId={categoryId}
        sectionTitleEn={sectionTitleEn}
        sectionIndex={sectionIndex}
        itemIndex={itemIndex}
        menuItem={menuItem}
        language={language}
        enabled={enabled}
        onClick={() => onOpenItem(menuItem, sectionTitleEn, categoryId)}
        variants={variants}
      >
        <div
          className="menu-card-media"
          onTouchStart={handleTouchStart}
          onTouchEnd={clearLongPress}
          onTouchCancel={clearLongPress}
        >
          <img src={menuItem.image} alt={menuItem.en} loading="lazy" decoding="async" />
          <button
            type="button"
            className="card-image-expand"
            onClick={handleExpandClick}
            aria-label={isArabic ? "تكبير الصورة" : "Expand photo"}
          >
            <Maximize2 size={14} strokeWidth={2.25} />
          </button>
        </div>
        <div className="menu-card-info menu-card-info-compact">
          <h3 className="menu-card-name">{isArabic ? menuItem.ar : menuItem.en}</h3>
          <div className="menu-card-meta">
            <span className="menu-card-cal">{menuItem.calories} cal</span>
            <strong className="menu-card-price">{menuItem.price}</strong>
          </div>
        </div>
        <ChevronRight className="chevron" />
      </ImpressionTracked>
      <Suspense fallback={null}>
        <ImageLightbox
          open={lightbox}
          src={menuItem.image}
          alt={menuItem.en}
          onClose={() => setLightbox(false)}
        />
      </Suspense>
    </>
  );
}
