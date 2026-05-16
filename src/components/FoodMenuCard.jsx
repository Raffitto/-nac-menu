import React, { useState, lazy, Suspense } from "react";
import { ChevronRight } from "lucide-react";
import ImpressionTracked from "./ImpressionTracked";
import { trackImageExpand } from "../lib/imageExpand";

const ImageLightbox = lazy(() => import("./ImageLightbox"));

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

  const handleImageTap = (e) => {
    e.stopPropagation();
    trackImageExpand({
      categoryId,
      sectionTitleEn,
      menuItem,
      language,
    });
    setLightbox(true);
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
        <button type="button" className="menu-card-image-btn" onClick={handleImageTap} aria-label="View photo">
          <img src={menuItem.image} alt={menuItem.en} loading="lazy" decoding="async" />
        </button>
        <div className="menu-card-info menu-card-info-compact">
          <h3>{isArabic ? menuItem.ar : menuItem.en}</h3>
          <div className="menu-card-bottom">
            <span>{menuItem.calories} cal</span>
            <strong>{menuItem.price}</strong>
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
