import mocktails from "./mocktails";
import rest from "./rest";

export const DRINK_BIBLE_SOURCE = "NAC Drinks Master · Editable Working File · 22 Aug 2026";

const raw = [...mocktails, ...rest];

export const DRINK_BIBLE_ITEMS = raw.map((item, index) => ({
  id: `drink-${index + 1}`,
  name: item.n,
  category: item.c,
  glass: item.g || null,
  ice: item.i || null,
  garnish: item.a || null,
  portion: item.p || null,
  batch: item.b || null,
  workingNotes: item.x || null,
  ingredients: (item.d || []).map(([name, quantity, unit, notes]) => ({ name, quantity, unit, notes })),
  method: item.m || null,
  sourceNotes: item.s || null,
  reviewReasons: item.r || [],
  needsReview: Boolean(item.r?.length),
  sourceOnly: Boolean(item.o),
}));

export const DRINK_BIBLE_CATEGORIES = [...new Set(DRINK_BIBLE_ITEMS.map((item) => item.category))];
