import React, { useState } from "react";
import { menuImageSources } from "../lib/menuImageSources";

export default function MenuImage({ src, alt = "", className = "", priority = false }) {
  const [loaded, setLoaded] = useState(false);
  if (!src?.trim()) return null;

  const sources = menuImageSources(src);
  const loading = priority ? "eager" : "lazy";

  return (
    <img
      src={sources.card}
      srcSet={sources.webp || undefined}
      sizes={sources.webp ? sources.sizes : undefined}
      alt={alt}
      className={`menu-img-fade ${loaded ? "menu-img-fade--loaded" : ""} ${className}`.trim()}
      loading={loading}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
    />
  );
}
