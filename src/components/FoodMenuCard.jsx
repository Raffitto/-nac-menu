import React, { useState, lazy, Suspense } from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import ImpressionTracked from "./ImpressionTracked";
import { trackImageExpand } from "../lib/imageExpand";

const ImageLightbox = lazy(() => import("./ImageLightbox"));

function hasImageSrc(menuItem) {
  return Boolean(menuItem?.image && String(menuItem.image).trim());
}

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
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleCardClick = () => {
    if (!menuItem?.en || !categoryId) return;
    setLightboxOpen(false);
    onOpenItem(menuItem, sectionTitleEn, categoryId);
  };

  const handleExpandClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasImageSrc(menuItem)) return;
    trackImageExpand({
      categoryId,
      sectionTitleEn,
      menuItem,
      language,
    });
    setLightboxOpen(true);
  };

  return (
    <>
      <ImpressionTracked
        className="menu-card menu-card-compact"
        categoryId={categoryId}
        sectionTitleEn={sectionTitleEn}
        sectionIndex={sectionIndex}
        itemIndex={itemIndex}
        menuItem={menuItem}
        language={language}
        enabled={enabled}
        onClick={handleCardClick}
        variants={variants}
      >
        <div className="menu-card-media">
          {hasImageSrc(menuItem) && (
            <img src={menuItem.image} alt="" loading="lazy" decoding="async" draggable={false} />
          )}
          {hasImageSrc(menuItem) && (
            <button
              type="button"
              className="card-image-expand"
              onClick={handleExpandClick}
              aria-label={isArabic ? "تكبير الصورة" : "Expand photo"}
            >
              <Maximize2 size={14} strokeWidth={2.25} />
            </button>
          )}
        </div>
        <div className="menu-card-info menu-card-info-compact">
          <h3 className="menu-card-name">{isArabic ? menuItem.ar : menuItem.en}</h3>
          <div className="menu-card-meta">
            <span className="menu-card-cal">{menuItem.calories} cal</span>
            <strong className="menu-card-price">{menuItem.price}</strong>
          </div>
        </div>
        <ChevronRight className="chevron" aria-hidden />
      </ImpressionTracked>
      {hasImageSrc(menuItem) && (
        <Suspense fallback={null}>
          <ImageLightbox
            open={lightboxOpen}
            src={menuItem.image}
            alt={menuItem.en}
            onClose={() => setLightboxOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
