import React, { useState, lazy, Suspense } from "react";
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

  const handleImageTap = (e) => {
    e.stopPropagation();
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
        <button type="button" className="drink-card-image-btn" onClick={handleImageTap} aria-label="View photo">
          <img src={menuItem.image} alt={menuItem.en} loading="lazy" decoding="async" />
        </button>
        <div className="drink-card-body">
          <span className="drink-card-name">{isArabic ? menuItem.ar : menuItem.en}</span>
          <span className="drink-card-price">{menuItem.price}</span>
        </div>
      </ImpressionTracked>
      <Suspense fallback={null}>
        <ImageLightbox open={lightbox} src={menuItem.image} alt={menuItem.en} onClose={() => setLightbox(false)} />
      </Suspense>
    </>
  );
}
