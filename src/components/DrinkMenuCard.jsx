import React, { useState, lazy, Suspense } from "react";
import { ChevronRight, Maximize2 } from "lucide-react";
import ImpressionTracked from "./ImpressionTracked";
import MenuImage from "./MenuImage";
import { trackImageExpand } from "../lib/imageExpand";

const ImageLightbox = lazy(() => import("./ImageLightbox"));

function hasImageSrc(menuItem) {
  return Boolean(menuItem?.image && String(menuItem.image).trim());
}

export default function DrinkMenuCard({
  menuItem,
  categoryId,
  sectionTitleEn,
  sectionIndex,
  itemIndex,
  language,
  isArabic,
  enabled,
  highlighted = false,
  onOpenItem,
  variants,
}) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const soldOut = Boolean(menuItem?.soldOut);
  const isHighlighted = Boolean(highlighted || menuItem?.featured);
  const showCal = menuItem.calories && menuItem.calories !== "-";

  const handleCardClick = () => {
    if (!menuItem?.en || !categoryId) return;
    setLightboxOpen(false);
    onOpenItem(menuItem, sectionTitleEn, categoryId);
  };

  const handleExpandClick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!hasImageSrc(menuItem)) return;
    trackImageExpand({ categoryId, sectionTitleEn, menuItem, language });
    setLightboxOpen(true);
  };

  return (
    <>
      <ImpressionTracked
        asMotion={false}
        className={`drink-card${soldOut ? " menu-card-sold-out" : ""}${isHighlighted ? " menu-card-featured" : ""}`}
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
        {isHighlighted && (
          <span className="menu-card-featured-badge">
            {isArabic ? "موصى به" : "Featured"}
          </span>
        )}
        <div className="drink-card-media">
          {hasImageSrc(menuItem) && (
            <MenuImage src={menuItem.image} alt="" />
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
        {soldOut && (
          <span className="menu-card-sold-out-pill">
            {isArabic ? "غير متوفر" : "Sold out"}
          </span>
        )}
        <div className="drink-card-body">
          <span className="drink-card-name">{isArabic ? menuItem.ar : menuItem.en}</span>
          <div className="menu-card-meta drink-card-meta">
            {showCal ? (
              <span className="menu-card-cal">{menuItem.calories} cal</span>
            ) : (
              <span className="menu-card-cal menu-card-cal-empty" />
            )}
            <strong className="menu-card-price drink-card-price">{menuItem.price}</strong>
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
