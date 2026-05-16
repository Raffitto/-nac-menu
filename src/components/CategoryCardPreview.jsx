import React from "react";
import { getCategoryFallbackIcon } from "../lib/menuPresentation";

export default function CategoryCardPreview({ category, previewItems, isArabic }) {
  const fallback = getCategoryFallbackIcon(category, isArabic);
  const items = (previewItems || []).filter((i) => i?.image?.trim());

  if (!items.length) {
    return (
      <img
        src={fallback}
        alt=""
        className={`category-icon ${isArabic ? "arabic-icon" : ""} ${category.id}`}
      />
    );
  }

  if (items.length === 1) {
    return (
      <img
        src={items[0].image}
        alt=""
        className={`category-icon category-icon-product ${isArabic ? "arabic-icon" : ""} ${category.id}`}
        loading="lazy"
        decoding="async"
      />
    );
  }

  return (
    <div
      className={`category-preview-mosaic category-preview-mosaic--${Math.min(items.length, 3)}`}
      aria-hidden
    >
      {items.slice(0, 3).map((item) => (
        <img key={`${item.en}-${item.image}`} src={item.image} alt="" loading="lazy" decoding="async" />
      ))}
    </div>
  );
}
