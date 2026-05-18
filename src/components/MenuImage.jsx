import React, { useState } from "react";

export default function MenuImage({ src, alt = "", className = "" }) {
  const [loaded, setLoaded] = useState(false);

  if (!src?.trim()) return null;

  return (
    <img
      src={src}
      alt={alt}
      className={`menu-img-fade ${loaded ? "menu-img-fade--loaded" : ""} ${className}`.trim()}
      loading="lazy"
      decoding="async"
      draggable={false}
      onLoad={() => setLoaded(true)}
    />
  );
}
