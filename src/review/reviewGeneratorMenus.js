/**
 * Branch menu catalogs for review generation — breakfast vs lunch/dinner realism.
 */

export const BRANCH_LABELS = {
  khobar: { en: "NAC Khobar", ar: "NAC الخبر" },
  jeddah: { en: "NAC Jeddah", ar: "NAC جدة" },
  riyadh: { en: "NAC Riyadh", ar: "NAC الرياض" },
};

const KHOBAR_BREAKFAST = [
  "avocado toast",
  "poached eggs avocado",
  "scrambled eggs",
  "shakshuka",
  "Turkish eggs",
  "Mediterranean breakfast",
  "pancakes",
  "French toast",
  "pastries basket",
  "2 eggs breakfast",
  "eggs florentine",
  "mushroom toast",
  "halloumi",
  "halloumi fries",
  "spicy fried egg",
];

const KHOBAR_MAIN = [
  "popcorn chicken",
  "chicken sliders",
  "sliders",
  "rigatoni pink sauce",
  "rigatoni pink sauce with chicken",
  "rigatoni pink sauce with prawn",
  "truffle risotto",
  "truffle risotto with chicken",
  "truffle risotto with prawn",
  "truffle burger",
  "black Angus steak",
  "smoked paprika prawn",
  "burrata",
  "crushed burrata",
  "kale cabbage salad",
  "quinoa salad",
  "house salad",
  "sumac chicken",
  "asparagus",
  "truffled mac and cheese",
  "beetroot hummus",
  "flamed aubergine",
  "frites",
  "olives",
  "honey sweet potato",
];

const KHOBAR_DESSERTS = ["churros", "pavlova", "affogato", "cookies"];

const KHOBAR_HOT = [
  "flat white",
  "cappuccino",
  "cortado",
  "latte",
  "Spanish latte",
  "mocha",
  "espresso",
  "double espresso",
  "macchiato",
  "breakfast tea",
  "jasmine tea",
  "hot chocolate",
];

const KHOBAR_ICED = [
  "iced latte",
  "iced Spanish latte",
  "coconut iced latte",
  "iced mocha",
  "toasted banana iced latte",
  "jasmine iced tea",
];

const KHOBAR_LEMONADES = [
  "basil lemonade",
  "passion fruit lemonade",
  "still homemade lemonade",
  "sparkling homemade lemonade",
  "orange pineapple",
  "raspberry mojito",
  "strawberry mojito",
  "passion fruit mojito",
  "classic mojito",
  "watermelon mint lemon",
  "apple lemon lime mint",
  "blackberry vanilla lemon",
  "pineapple rosemary mint",
  "lemon kumquat rosemary",
  "mango cardamom basil",
];

const LEGACY_FOODS = [
  { en: "popcorn chicken", ar: "بوبكورن تشيكن" },
  { en: "cajun chicken with fries", ar: "دجاج كاجون مع بطاطس" },
  { en: "Black Angus steak with fries", ar: "ستيك بلاك أنجوس مع بطاطس" },
  { en: "truffle corn risotto with chicken on top", ar: "ريزوتو ذرة بالكمأة مع دجاج" },
  { en: "kale salad", ar: "سلطة كيل" },
  { en: "rigatoni pasta with chicken sumac on top", ar: "ريغاتوني مع دجاج سماق" },
  { en: "oven baked mac & cheese", ar: "ماك آند تشيز بالفرن" },
  { en: "crushed burrata", ar: "بوراتا مفتتة" },
  { en: "truffle burger", ar: "ترافل برجر" },
];

const LEGACY_DRINKS = [
  { en: "cappuccino", ar: "كابتشينو" },
  { en: "flat white", ar: "فلات وايت" },
  { en: "latte", ar: "لاتيه" },
  { en: "raspberry mojito", ar: "موهيتو توت" },
  { en: "passion fruit lemonade", ar: "ليمونادة باشن فروت" },
  { en: "fresh orange juice", ar: "عصير برتقال فريش" },
  { en: "raspberry cranberry lemonade", ar: "ليمونادة توت وكرانبيري" },
  { en: "blackberry vanilla lemon", ar: "بلاكبيري فانيلا ليمون" },
];

/** Generic dish terms humans use instead of full menu names */
export const GENERIC_FOOD_EN = [
  "the pasta",
  "dessert",
  "coffee",
  "breakfast",
  "sliders",
  "the risotto",
  "the burger",
  "salad",
  "the steak",
  "brunch",
  "the eggs",
  "something sweet",
  "the chicken",
];

export const GENERIC_FOOD_AR = [
  "الباستا",
  "الحلى",
  "القهوة",
  "الفطور",
  "السلايدرز",
  "الريزوتو",
  "البرجر",
  "السلطة",
  "الستيك",
  "البرانش",
  "البيض",
  "شي حلو",
  "الدجاج",
];

export const KHOBAR_MANAGERS = ["Fady", "Raffi", "Bashar"];

export function getBranchMenu(branchId) {
  const branch = (branchId || "khobar").toLowerCase();
  if (branch === "khobar") {
    return {
      breakfast: KHOBAR_BREAKFAST,
      main: KHOBAR_MAIN,
      desserts: KHOBAR_DESSERTS,
      hotDrinks: KHOBAR_HOT,
      icedDrinks: KHOBAR_ICED,
      lemonades: KHOBAR_LEMONADES,
      allFoods: [...KHOBAR_BREAKFAST, ...KHOBAR_MAIN, ...KHOBAR_DESSERTS],
      allDrinks: [...KHOBAR_HOT, ...KHOBAR_ICED, ...KHOBAR_LEMONADES],
      legacy: false,
    };
  }
  const foodsEn = LEGACY_FOODS.map((f) => f.en);
  const drinksEn = LEGACY_DRINKS.map((d) => d.en);
  return {
    breakfast: ["French toast", "pancakes", "eggs", "avocado toast"],
    main: foodsEn,
    desserts: ["dessert"],
    hotDrinks: drinksEn.filter((d) => !d.includes("mojito") && !d.includes("lemonade")),
    icedDrinks: [],
    lemonades: drinksEn.filter((d) => d.includes("mojito") || d.includes("lemonade") || d.includes("juice")),
    allFoods: foodsEn,
    allDrinks: drinksEn,
    legacyFoods: LEGACY_FOODS,
    legacyDrinks: LEGACY_DRINKS,
    legacy: true,
  };
}

export function branchLabel(branchId, isAr) {
  const b = (branchId || "khobar").toLowerCase();
  return BRANCH_LABELS[b]?.[isAr ? "ar" : "en"] || "NAC";
}
