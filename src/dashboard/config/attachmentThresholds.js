/**
 * Expected modifier attachment rates (parent → modifier).
 * Used for missed-upsell detection and heat states.
 */
export const ATTACHMENT_EXPECTATIONS = [
  {
    id: "fries_burger",
    label: "Fries with burgers",
    parentPatterns: ["burger", "angus", "beef", "smash", "wagyu"],
    modifierPatterns: ["fries", "halloumi fries", "sweet potato"],
    expectedPct: 25,
  },
  {
    id: "truffle_rigatoni",
    label: "Protein with rigatoni",
    parentPatterns: ["rigatoni", "pasta", "penne"],
    modifierPatterns: ["chicken", "shrimp", "prawn", "beef"],
    expectedPct: 18,
  },
  {
    id: "chocolate_dessert",
    label: "Chocolate sauce with desserts",
    parentPatterns: ["churros", "pancake", "french toast", "waffle", "dessert", "pavlova"],
    modifierPatterns: ["chocolate sauce", "dark chocolate", "chocolate"],
    expectedPct: 15,
  },
  {
    id: "shot_coffee",
    label: "Extra shot with coffee",
    parentPatterns: ["coffee", "latte", "espresso", "cappuccino", "americano", "mocha", "macchiato"],
    modifierPatterns: ["extra shot", "shot"],
    expectedPct: 10,
  },
  {
    id: "milk_coffee",
    label: "Fresh milk with coffee",
    parentPatterns: ["coffee", "latte", "espresso", "cappuccino", "americano", "mocha", "tea"],
    modifierPatterns: ["fresh milk", "extra milk", "milk"],
    expectedPct: 12,
  },
  {
    id: "syrup_pancakes",
    label: "Maple syrup with breakfast",
    parentPatterns: ["pancake", "french toast", "waffle", "breakfast"],
    modifierPatterns: ["maple syrup", "syrup"],
    expectedPct: 20,
  },
  {
    id: "truffle_burger",
    label: "Truffle sauce with burgers",
    parentPatterns: ["burger", "angus", "beef"],
    modifierPatterns: ["truffle", "truffle mayo", "truffle sauce"],
    expectedPct: 12,
  },
];

export const DAYPARTS = [
  { id: "breakfast", label: "Breakfast", start: 5, end: 11 },
  { id: "lunch", label: "Lunch", start: 11, end: 16 },
  { id: "dinner", label: "Dinner", start: 16, end: 22 },
  { id: "late", label: "Late night", start: 22, end: 5 },
];
