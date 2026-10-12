import manifest from "./menuImageManifest.json";

const SIZES = "(max-width: 720px) 92vw, 480px";

export function buildMenuSources(src, entry) {
  if (!src || !entry?.widths?.length) {
    return { fallback: src, avif: null, webp: null, expand: src, sizes: SIZES };
  }
  const base = String(src).replace(/\.(jpe?g|png)$/i, "");
  const srcSet = (ext) => entry.widths.map((width) => `${base}-${width}.${ext} ${width}w`).join(", ");
  const widest = Math.max(...entry.widths);
  return {
    fallback: src,
    avif: entry.formats?.includes("avif") ? srcSet("avif") : null,
    webp: entry.formats?.includes("webp") ? srcSet("webp") : null,
    expand: entry.formats?.includes("webp") ? `${base}-${widest}.webp` : src,
    sizes: SIZES,
  };
}

export function menuImageSources(src) {
  if (!src) return buildMenuSources(src, null);
  const key = src.startsWith("/") ? src : `/${src}`;
  return buildMenuSources(src, manifest.images?.[key] || null);
}
