/**
 * Mutually exclusive dine-in session archetypes.
 * Classification uses NAC canonical semantic families, never Foodics name guesses.
 *
 * Policy:
 * - Unknown items never force an archetype when any known family is present.
 * - Unknown-only baskets are unclassified.
 * - Non-coffee beverages do not disqualify dessert-only or coffee-only
 *   (they are incidental drinks). Coffee + dessert without food is dessert_and_coffee.
 * - Full-service = food AND dessert, with or without drinks.
 */

import type { BasketFlags, CanonicalOrderItem, TableArchetype } from "./types.ts";

export function flagsFromItems(items: CanonicalOrderItem[]): BasketFlags {
  const flags: BasketFlags = {
    hasFood: false,
    hasDessert: false,
    hasCoffee: false,
    hasOtherBeverage: false,
    hasUnclassified: false,
    knownItemCount: 0,
  };
  for (const item of items) {
    if (item.status === "void" || item.status === "cancelled") continue;
    if (item.canonicalCategory === "food") {
      flags.hasFood = true;
      flags.knownItemCount += 1;
    } else if (item.canonicalCategory === "dessert") {
      flags.hasDessert = true;
      flags.knownItemCount += 1;
    } else if (item.canonicalCategory === "coffee") {
      flags.hasCoffee = true;
      flags.knownItemCount += 1;
    } else if (item.canonicalCategory === "other_beverage") {
      flags.hasOtherBeverage = true;
      flags.knownItemCount += 1;
    } else {
      flags.hasUnclassified = true;
    }
  }
  return flags;
}

export function classifyTableArchetype(flags: BasketFlags): TableArchetype {
  const { hasFood, hasDessert, hasCoffee, knownItemCount } = flags;
  if (knownItemCount === 0) return "unclassified";
  if (hasFood && hasDessert) return "full_service";
  if (hasFood && (hasCoffee || flags.hasOtherBeverage)) return "food_and_beverage";
  if (hasFood) return "food_only";
  if (hasDessert && hasCoffee) return "dessert_and_coffee";
  if (hasDessert) return "dessert_only";
  if (hasCoffee) return "coffee_only";
  if (flags.hasOtherBeverage) return "beverage_only";
  return "unclassified";
}

export function isDessertFocused(archetype: TableArchetype): boolean {
  return archetype === "dessert_only" || archetype === "dessert_and_coffee";
}

export function isFoodContaining(archetype: TableArchetype): boolean {
  return archetype === "food_only" || archetype === "food_and_beverage" || archetype === "full_service";
}

export function isCoffeeLed(archetype: TableArchetype): boolean {
  return archetype === "coffee_only" || archetype === "dessert_and_coffee";
}

export function hasDessertItem(archetype: TableArchetype): boolean {
  return archetype === "dessert_only" || archetype === "dessert_and_coffee" || archetype === "full_service";
}

export const ARCHETYPE_LABELS: Record<TableArchetype, string> = {
  dessert_only: "dessert-only",
  coffee_only: "coffee-only",
  dessert_and_coffee: "dessert and coffee",
  food_only: "food-only",
  food_and_beverage: "food and beverage",
  full_service: "full-service",
  beverage_only: "other beverage-only",
  unclassified: "unclassified",
};
