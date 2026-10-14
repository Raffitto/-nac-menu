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
