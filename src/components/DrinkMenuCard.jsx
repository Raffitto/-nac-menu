import React, { useState, lazy, Suspense } from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import ImpressionTracked from "./ImpressionTracked";
import { trackImageExpand } from "../lib/imageExpand";

const ImageLightbox = lazy(() => import("./ImageLightbox"));

export default function DrinkMenuCard({
  menuItem,
  categoryId,
  sectionTitleEn,
  sectionIndex,
  itemIndex,
  language,
  isArabic,
  enabled,
  onOpenItem,
}) {
  const [lightbox, setLightbox] = useState(false);
  const showCal = menuItem.calories && menuItem.calories !== "-";

  const handleExpandClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    trackImageExpand({ categoryId, sectionTitleEn, menuItem, language });
    setLightbox(true);
  };

  return (
    <>
      <ImpressionTracked
        asMotion={false}
        className="drink-card"
        categoryId={categoryId}
        sectionTitleEn={sectionTitleEn}
        sectionIndex={sectionIndex}
        itemIndex={itemIndex}
        menuItem={menuItem}
        language={language}
        enabled={enabled}
        onClick={() => onOpenItem(menuItem, sectionTitleEn, categoryId)}
      >
        <div className="drink-card-media">
          <img src={menuItem.image} alt="" loading="lazy" decoding="async" draggable={false} />
          <button
            type="button"
            className="card-image-expand"
            onClick={handleExpandClick}
            aria-label={isArabic ? "تكبير الصورة" : "Expand photo"}
          >
            <Maximize2 size={14} strokeWidth={2.25} />
          </button>
        </div>
        <div className="drink-card-body">
          <span className="drink-card-name">{isArabic ? menuItem.ar : menuItem.en}</span>
          <div className="menu-card-meta drink-card-meta">
            {showCal ? <span className="menu-card-cal">{menuItem.calories} cal</span> : <span className="menu-card-cal menu-card-cal-empty" />}
            <strong className="menu-card-price drink-card-price">{menuItem.price}</strong>
          </div>
        </div>
        <ChevronRight className="chevron" aria-hidden />
      </ImpressionTracked>
      <Suspense fallback={null}>
        <ImageLightbox open={lightbox} src={menuItem.image} alt={menuItem.en} onClose={() => setLightbox(false)} />
      </Suspense>
    </>
  );
}
