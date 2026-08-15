/**
 * Commercial gap decomposition. Measurable components only — no operational causes.
 */

import type { ServiceMixResult } from "./types.ts";

export type DecompositionComponent = {
  id: "session_volume" | "archetype_mix" | "spend_per_session" | "dessert_conversion" | "covers";
  label: string;
  current: number | null;
  other: number | null;
  contributionNote: string;
};

export function decomposeCommercialGap(input: {
  current: ServiceMixResult;
  other: ServiceMixResult;
  currentCovers?: number | null;
  otherCovers?: number | null;
  currentHeadlineSales?: number | null;
  otherHeadlineSales?: number | null;
}): DecompositionComponent[] {
  const a = input.current;
  const b = input.other;
  const currentCheck = a.totalSessions ? MIX_SALES(a) / a.totalSessions : null;
  const otherCheck = b.totalSessions ? MIX_SALES(b) / b.totalSessions : null;
  const components: DecompositionComponent[] = [
    {
      id: "session_volume",
      label: "completed dine-in sessions",
      current: a.totalSessions,
      other: b.totalSessions,
      contributionNote: compareCount(a.totalSessions, b.totalSessions, "sessions"),
    },
    {
      id: "archetype_mix",
      label: "session mix",
      current: a.foodContainingShare,
      other: b.foodContainingShare,
      contributionNote: mixNote(a, b),
    },
    {
      id: "spend_per_session",
      label: "average check",
      current: currentCheck,
      other: otherCheck,
      contributionNote: moneyNote(currentCheck, otherCheck),
    },
    {
      id: "dessert_conversion",
      label: "dessert conversion of food-containing sessions",
      current: a.dessertConversion,
      other: b.dessertConversion,
      contributionNote: ppNote("Dessert conversion", a.dessertConversion, b.dessertConversion),
    },
  ];
  if (input.currentCovers != null || input.otherCovers != null) {
    components.unshift({
      id: "covers",
      label: "covers",
      current: input.currentCovers ?? null,
      other: input.otherCovers ?? null,
      contributionNote: compareCount(input.currentCovers || 0, input.otherCovers || 0, "covers"),
    });
  }
  return components;
}

function MIX_SALES(mix: ServiceMixResult): number {
  return Object.values(mix.byArchetype).reduce((s, row) => s + row.netSales, 0);
}

function compareCount(current: number, other: number, unit: string): string {
  const delta = current - other;
  if (!delta) return `${unit} are in line.`;
  return delta < 0
    ? `${Math.abs(delta)} fewer ${unit}.`
    : `${delta} more ${unit}.`;
}

function mixNote(a: ServiceMixResult, b: ServiceMixResult): string {
  const foodPp = ((a.foodContainingShare || 0) - (b.foodContainingShare || 0)) * 100;
  const dessertPp = ((a.dessertFocusedShare || 0) - (b.dessertFocusedShare || 0)) * 100;
  return `Food-containing share is ${foodPp.toFixed(1)} percentage points ${foodPp < 0 ? "lower" : "higher"}; dessert-focused share is ${dessertPp.toFixed(1)} percentage points ${dessertPp < 0 ? "lower" : "higher"}.`;
}

function moneyNote(current: number | null, other: number | null): string {
  if (current == null || other == null) return "Average check is not comparable.";
  const delta = current - other;
  if (Math.abs(delta) < 0.5) return "Average check is in line.";
  return delta < 0
    ? `Average check is SAR ${Math.abs(delta).toFixed(2)} lower.`
    : `Average check is SAR ${delta.toFixed(2)} higher.`;
}

function ppNote(label: string, current: number | null, other: number | null): string {
  if (current == null || other == null) return `${label} is not comparable.`;
  const pp = (current - other) * 100;
  return `${label} is ${Math.abs(pp).toFixed(1)} percentage points ${pp < 0 ? "lower" : "higher"}.`;
}

export function investigationWording(components: DecompositionComponent[]): string {
  const volume = components.find((c) => c.id === "session_volume" || c.id === "covers");
  const mix = components.find((c) => c.id === "archetype_mix");
  const parts = [
    "The measurable opportunities are guest/session volume and food-session penetration.",
    "Operationally, the first areas worth reviewing are food-focused acquisition, reception positioning, menu presentation, and staff food upselling.",
    "Those are investigation areas, not proven causes.",
  ];
  if (volume && mix) return parts.join(" ");
  return parts[2];
}
