const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "waiterPos.css"), "utf8");

function channel(value) {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground, background) {
  const lum = (hex) => {
    const value = parseInt(hex.slice(1), 16);
    return (0.2126 * channel((value >> 16) & 255))
      + (0.7152 * channel((value >> 8) & 255))
      + (0.0722 * channel(value & 255));
  };
  const light = Math.max(lum(foreground), lum(background));
  const dark = Math.min(lum(foreground), lum(background));
  return (light + 0.05) / (dark + 0.05);
}

function token(name) {
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing color token ${name}`);
  return match[1];
}

test("forest surfaces use near-white text at AA contrast", () => {
  const onForest = token("--pos-on-forest");
  expect(contrast(onForest, token("--pos-forest"))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(onForest, token("--pos-forest-deep"))).toBeGreaterThanOrEqual(4.5);
  expect(css).toMatch(/\.pos button\.pos-action[\s\S]*?color:\s*var\(--pos-on-forest\)/);
  expect(css).toMatch(/\.pos button\.pos-checkbar[\s\S]*?color:\s*var\(--pos-on-forest\)/);
  expect(css).toMatch(/\.pos \.pos-cats button\[aria-pressed="true"\][\s\S]*?color:\s*var\(--pos-on-forest\)/);
  expect(css).toMatch(/\.pos button\.pos-back[\s\S]*?color:\s*var\(--pos-on-forest\)/);
  expect(css).toMatch(/\.pos \.pos-grand[\s\S]*?color:\s*var\(--pos-on-forest\)/);
});

test("body, secondary, and status text clear AA on cream and white", () => {
  const card = token("--pos-card");
  const paper = token("--pos-paper");
  const cream = token("--pos-cream");
  expect(contrast(token("--pos-ink"), cream)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-ink-soft"), card)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-ink-soft"), paper)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-ink-soft"), cream)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-free"), card)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-dining"), card)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-seated"), card)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-warn"), paper)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-danger"), cream)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-notice-ink"), token("--pos-notice-bg"))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-alert-ink"), token("--pos-alert-bg"))).toBeGreaterThanOrEqual(4.5);
  expect(contrast(token("--pos-forest"), paper)).toBeGreaterThanOrEqual(4.5);
});

test("status borders clear the non-text contrast minimum", () => {
  const cream = token("--pos-cream");
  expect(contrast(token("--pos-free-border"), cream)).toBeGreaterThanOrEqual(3);
  expect(contrast(token("--pos-dining-border"), token("--pos-card"))).toBeGreaterThanOrEqual(3);
  expect(contrast(token("--pos-seated-border"), cream)).toBeGreaterThanOrEqual(3);
});
