import manifest from "./menuImageManifest.json";

const SIZES = "(max-width: 720px) 92vw, 480px";

export function buildMenuSources(src, entry) {
  const original = src;
  if (!src || !entry?.widths?.length || !entry.formats?.includes("webp")) {
    return { fallback: original, avif: null, webp: null, card: original, expand: original, sizes: SIZES };
  }
  const base = String(src).replace(/\.(jpe?g|png)$/i, "");
  const widest = Math.max(...entry.widths);
  return {
    fallback: original,
    avif: null,
    webp: entry.widths.map((width) => `${base}-${width}.webp ${width}w`).join(", "),
    card: `${base}-${widest}.webp`,
    expand: original,
    sizes: SIZES,
  };
}

export function menuImageSources(src) {
  if (!src) return buildMenuSources(src, null);
  const key = src.startsWith("/") ? src : `/${src}`;
  return buildMenuSources(src, manifest.images?.[key] || null);
}

/** Display URL for a customization photo. Uses an existing same-size WebP only when one is published. */
export function customizationDisplaySrc(src) {
  const sources = menuImageSources(src);
  const display = sources.card || src || "";
  const fallback = sources.expand || sources.fallback || src || "";
  return {
    display,
    fallback,
    usesVariant: Boolean(sources.webp) && display !== fallback,
  };
}
