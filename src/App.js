import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform, useDragControls } from "framer-motion";
import { X } from "lucide-react";
import "./styles.css";
import AdminDashboard from "./dashboard/AdminDashboard";
import ContextualMenuView from "./components/ContextualMenuView";
import { getContextualFlow, getContextualGreeting } from "./lib/contextualMenu";
import { makeSectionDomId, sectionSlug } from "./lib/sectionNav";
import {
  trackEvent,
  makeMenuItemId,
  isNewSession,
  markSessionLogged,
  getSessionStartTime,
  trackTimeSpent,
} from "./lib/analytics";
import { useMenuData } from "./lib/useMenuData";
import { applyMenuOrdering, getMenuPreviewItems } from "./lib/menuPresentation";
import CategoryCardPreview from "./components/CategoryCardPreview";

const _fallbackCategories = [
  {
    id: "brunch",
    en: "Brunch",
    ar: "برانش",
    timeEn: "Fri & Sat · 12–5 PM",
    timeAr: "الجمعة والسبت · ١٢–٥ م",
    icon: "/menu-icons/brunch.png",
    iconAr: "/menu-icons-ar/brunch.png",
  },
  {
    id: "daytime",
    en: "Daytime",
    ar: "النهار",
    timeEn: "Sun–Thu · 12–5 PM",
    timeAr: "الأحد–الخميس · ١٢–٥ م",
    icon: "/menu-icons/daytime.png",
    iconAr: "/menu-icons-ar/daytime.png",
  },
  {
    id: "breakfast",
    en: "Breakfast",
    ar: "الفطور",
    timeEn: "9–12 AM",
    timeAr: "٩–١٢ ص",
    icon: "/menu-icons/breakfast.svg",
    iconAr: "/menu-icons-ar/Breakfast.png",
  },
  {
    id: "evening",
    en: "Evening Menu",
    ar: "المساء",
    timeEn: "5–11:30 PM",
    timeAr: "٥–١١:٣٠ م",
    icon: "/menu-icons/evening.png",
    iconAr: "/menu-icons-ar/dinner.png",
  },
  {
    id: "desserts",
    en: "Desserts",
    ar: "حلى",
    timeEn: "All Day",
    timeAr: "طوال اليوم",
    icon: "/menu-icons/desserts.png",
    iconAr: "/menu-icons-ar/dessert.png",
  },
  {
    id: "drinks",
    en: "Drinks",
    ar: "مشروبات",
    timeEn: "All Day",
    timeAr: "طوال اليوم",
    icon: "/menu-icons/drinks.png",
    iconAr: "/menu-icons-ar/drinks.png",
  },
];

const addOns = {
  chicken: {
  en: "Add Chicken",
  ar: "إضافة دجاج",
  price: "25 SAR",
  calories: 160,
  allergens: ["se"],
  previewImage: "/rigatoni-pink-sauce-chicken.jpg",
},
  prawns: {
  en: "Add Smoked Paprika Prawn",
  ar: "إضافة جمبري بالبابريكا المدخنة",
  price: "37 SAR",
  calories: 133,
  allergens: ["sh"],
  previewImage: "/rigatoni-pink-sauce-prawn.jpg",
},
prawnsRisotto: {
  en: "Add Smoked Paprika Prawn",
  ar: "إضافة جمبري بالبابريكا المدخنة",
  price: "37 SAR",
  calories: 133,
  allergens: ["sh"],
  previewImage: "/truffle-risotto-prawn.jpg",
},
  truffleSauce: { en: "Truffle Sauce", ar: "صلصة الكمأة", price: "8 SAR", calories: "-", allergens: [] },
  extraPatty: { en: "Extra Patty", ar: "قطعة لحم إضافية", price: "33 SAR", calories: "-", allergens: [] },
  asparagus: { en: "Asparagus & Toasted Hazelnuts", ar: "الهليون والبندق المحمص", price: "39 SAR", calories: 131, allergens: ["n"] },
  houseSalad: { en: "House Salad", ar: "سلطة المنزل", price: "29 SAR", calories: 249, allergens: ["s", "n"] },
  frites: { en: "Frites", ar: "بطاطس مقلية", price: "25 SAR", calories: 312, allergens: [] },
  grilledHalloumi: { en: "Grilled Halloumi", ar: "حلومي مشوي", price: "19 SAR", calories: 300, allergens: ["d", "se"] },
  sumacChicken: { en: "Sumac Chicken", ar: "دجاج بالسماق", price: "25 SAR", calories: 160, allergens: ["se"] },
  extraSlider: { en: "Additional Slider Piece", ar: "قطعة سلايدر إضافية", price: "19 SAR", calories: "-", allergens: ["g", "e", "m", "s", "se"] },
  darkChocolate: { en: "Dark Chocolate", ar: "شوكولاتة داكنة", price: "6 SAR", calories: "-", allergens: [] },
  pita: { en: "Pita Bread", ar: "خبز بيتا", price: "6 SAR", calories: "-", allergens: ["g"] },
  sourdough: { en: "Sourdough Bread", ar: "خبز ساوردو", price: "6 SAR", calories: "-", allergens: ["g"] },
  montereyJack: { en: "Monterey Jack Cheese", ar: "جبنة مونتيري جاك", price: "8 SAR", calories: "-", allergens: ["d"] },
  beefBacon: { en: "Beef Bacon", ar: "لحم بقري مقدد", price: "19 SAR", calories: 400, allergens: [] },
  avocado: { en: "Avocado Slices", ar: "شرائح أفوكادو", price: "15 SAR", calories: 90, allergens: [] },
  mushrooms: { en: "Mushrooms", ar: "فطر", price: "20 SAR", calories: 358, allergens: [] },
  parmesan: { en: "Extra Parmesan Cheese", ar: "إضافة جبنة بارميزان", price: "8 SAR", calories: "-", allergens: ["d"] },
  maple: { en: "Extra Maple Syrup", ar: "إضافة شراب القيقب", price: "6 SAR", calories: "-", allergens: [] },
  dulce: { en: "Extra Dulce de Leche", ar: "...", price: "6 SAR", calories: "-", allergens: ["d"] },
sumacChickenRisotto: {
  en: "Add Sumac Chicken",
  ar: "إضافة دجاج بالسماق",
  price: "25 SAR",
  calories: 160,
  allergens: ["se"],
  previewImage: "/truffle-risotto-chicken.jpg",
},
  milkUpgrade: { en: "Milk Upgrade (Almond, Oat, Coconut)", ar: "تبديل الحليب (لوز، شوفان، جوز الهند)", price: "6 SAR", allergens: [] },
  vanillaSyrup: { en: "Vanilla Syrup", ar: "شراب الفانيلا", price: "6 SAR", allergens: [] },
}; //

const item = (
  en,
  ar,
  descEn,
  descAr,
  calories,
  price,
  image,
  recommended = [],
  allergens = [],
  tags = []
) => ({
  en,
  ar,
  descEn,
  descAr,
  calories,
  price,
  image,
  recommended,
  allergens,
  tags,
});

const section = (en, ar, items) => ({
  title: { en, ar },
  items,
});
const _fallbackAllergenLabels = {
  g: { en: "Gluten", ar: "جلوتين" },
  d: { en: "Dairy", ar: "ألبان" },
  e: { en: "Eggs", ar: "بيض" },
  n: { en: "Nuts", ar: "مكسرات" },
  se: { en: "Sesame", ar: "سمسم" },
  m: { en: "Mustard", ar: "خردل" },
  s: { en: "Soya", ar: "صويا" },
  sh: { en: "Shellfish", ar: "محار" },
  f: { en: "Fish", ar: "سمك" },
  su: { en: "Sulphites", ar: "كبريتيت" },
};
const _fallbackMenuData = {
  breakfast: [
    section("Grains", "الحبوب", [
      item("Greek Yogurt", "زبادي يوناني", "House granola, raspberries, caramel toast.", "جرانولا منزلية، توت، توست كراميل.", 817, "52 SAR", "/greek-yogurt.jpg", [], ["g", "d", "n"], ["vegetarian"]),
    ]),

    section("Eggs", "البيض", [
      item("2 Eggs Any Style", "٢ بيض من أي نوع", "Fried, scrambled or poached.", "مقلي، مخفوق أو مسلوق.", 461.4, "31 SAR", "/2-eggs.jpg", [addOns.beefBacon, addOns.avocado, addOns.mushrooms, addOns.montereyJack], ["e", "g"], ["vegetarian"]),

      item("Scrambled Eggs", "بيض مخفوق", "Monterrey Jack, jalapeño mayo, brioche bun.", "مونتيري جاك، مايونيز هلابينو، خبزة البريوش.", 751, "49 SAR", "/scrambled-eggs.jpg", [], ["g", "d", "e"], ["vegetarian"]),

      item("Turkish Eggs", "بيض تركي", "Cajun butter, pita.", "زبدة كاجون، بيتا.", 698, "49 SAR", "/turkish-eggs.jpg", [addOns.pita, addOns.sourdough], ["g", "d", "e"], ["vegetarian"]),

      item("Shakshuka", "شكشوكة", "Baked eggs, feta, za’atar, pita.", "بيض مخبوز، جبنة الفيتا، زعتر، بيتا.", 575, "49 SAR", "/shakshuka.jpg", [addOns.pita, addOns.sourdough], ["e", "g", "se"], ["vegetarian"]),

      item("Poached Eggs & Avocado Toast", "بيض مسلوق مع توست أفوكادو", "Feta, coriander pesto.", "جبنة فيتا، بيستو الكزبرة.", 638, "65 SAR", "/poached-eggs-avocado.jpg", [], ["e", "g", "d"], ["vegetarian"]),

      item("Mediterranean Breakfast", "إفطار البحر الأبيض المتوسط", "Fried eggs, tzatziki, avocado, tomato, cucumber, red onion salad, baby peppers, halloumi and pita.", "بيض مقلي، تزاتزيكي، أفوكادو، سلطة طماطم وخيار وبصل أحمر، فلفل صغير، حلومي وبيتا.", 898, "69 SAR", "/mediterranean-breakfast.jpg", [addOns.pita, addOns.sourdough], ["e", "d", "g", "se"], ["vegetarian"]),
    ]),

    section("Sweets", "حلى", [
      item("Daily Pastries Basket", "سلة المعجنات", "Fresh pastries basket.", "سلة معجنات طازجة.", 1162, "39 SAR", "/pastries-basket.jpg", [], ["g", "d", "e"], ["vegetarian"]),

      item("Crushed Milk Chocolate Cookies", "كوكيز شوكولاتة الحليب المطحون", "Frosties soft serve.", "فروستيز ناعم.", 1067, "62 SAR", "/cookies.jpg", [], ["g", "d", "e"], ["vegetarian"]),

      item("Speculoos French Toast", "سبشلوس فرنش توست", "Raspberries, clotted cream. Allow 10 minutes.", "مع التوت والكريمة الثقيلة. يحتاج 10 دقائق.", 462, "55 SAR", "/frenchtoast.jpg", [addOns.darkChocolate, addOns.maple], ["g", "d", "e"], ["vegetarian"]),

      item("Ricotta Pancakes", "فطائر ريكوتا", "Dulce de leche, banana.", "دولسي دي ليتشي مع الموز.", 840, "59 SAR", "/pancakes.jpg", [addOns.darkChocolate, addOns.maple, addOns.dulce], ["g", "d", "e"], ["vegetarian"]),
    ]),

    section("Sides", "الأطباق الجانبية", [
      item("Mushrooms", "فطر", "Breakfast side.", "طبق جانبي للفطور.", 358, "20 SAR", "/mushrooms.jpg", [], [], ["vegan"]),
      item("Beef Bacon", "لحم بقري مقدد", "Breakfast side.", "طبق جانبي للفطور.", 400, "19 SAR", "/beef-bacon.jpg", [], [], []),
      item("Avocado", "أفوكادو", "Breakfast side.", "طبق جانبي للفطور.", 90, "15 SAR", "/avocado.jpg", [], [], ["vegan"]),
      item("Halloumi", "حلومي", "Breakfast side.", "طبق جانبي للفطور.", 721, "19 SAR", "/halloumi.jpg", [], ["d", "se"], ["vegetarian"]),
    ]),

    section("Plates", "الأطباق الرئيسية", [
      item("Mushroom Toast", "توست الفطر", "Hazelnut salt.", "مع البندق المملح.", 312, "59 SAR", "/mushroom-toast.jpg", [], ["g", "d", "n"], ["vegetarian"]),

      item("Chicken Sliders", "سلايدر برجر دجاج", "Sriracha mayo. Comes as 3 pieces.", "مايونيز السيراتشا. يأتي 3 قطع.", 840, "69 SAR", "/chicken-sliders.jpg", [addOns.extraSlider], ["g", "e", "m", "s", "se"], []),

      item("Kale & Cabbage", "كيل وملفوف", "Parmigiano, pine nuts, honey za’atar dressing.", "بارميزان، صنوبر، صلصة الزعتر والعسل.", 371, "59 SAR", "/kale-cabbage.jpg", [addOns.sumacChicken, addOns.grilledHalloumi], ["g", "m", "n", "se"], ["vegetarian"]),
    ]),
  ],

  brunch: [
    section("Nibbles", "المقبلات", [
      item("Olives", "زيتون", "Simple, bright and savoury.", "زيتون.", 115, "16 SAR", "/olives.jpg", [], [], ["vegan"]),

      item("Beetroot Hummus & Feta", "حمص بالشمندر مع الفيتا", "Beetroot hummus with feta.", "حمص بالشمندر مع جبنة الفيتا.", 579, "29 SAR", "/beetroot-hummus.jpg", [addOns.pita, addOns.sourdough], ["g", "d", "se"], ["vegetarian"]),

      item("Halloumi Fries", "أصابع الحلومي", "Honey sriracha.", "مع عسل السيراتشا.", 721, "39 SAR", "/halloumi-fries.jpg", [], ["d", "se"], ["vegetarian"]),
    ]),

    section("Eggs", "البيض", [
      item("2 Eggs Any Style", "٢ بيض من أي نوع", "Fried, scrambled or poached.", "مقلي، مخفوق أو مسلوق.", 461.4, "31 SAR", "/2-eggs.jpg", [addOns.beefBacon, addOns.avocado, addOns.mushrooms, addOns.montereyJack], ["e", "g"], ["vegetarian"]),

      item("Scrambled Eggs", "بيض مخفوق", "Monterrey Jack, jalapeño mayo, brioche bun.", "جبن مونتيري جاك، مايونيز هالبينو، خبز بريوش.", 869.25, "49 SAR", "/scrambled-eggs.jpg", [], ["g", "d", "e"], ["vegetarian"]),

      item("Turkish Eggs", "بيض تركي", "Cajun butter, pita.", "زبدة الكاجون، خبز.", 697.5, "49 SAR", "/turkish-eggs.jpg", [addOns.pita, addOns.sourdough], ["g", "d", "e"], ["vegetarian"]),

      item("Eggs Florentine", "بيض فلورنتين", "Greens, Hollandaise, muffin.", "خضار، صلصة هولنديز، مافن.", 858, "59 SAR", "/eggs-florentine.jpg", [], ["g", "d", "e"], ["vegetarian"]),

      item("Poached Eggs & Avocado Toast", "بيض مسلوق مع توست الأفوكادو", "Feta, coriander pesto.", "جبنة فيتا، بيستو بالكزبرة.", 638, "65 SAR", "/poached-eggs-avocado.jpg", [], ["g", "d", "e"], ["vegetarian"]),
    ]),

    section("Salads", "سلطات", [
      item("Quinoa", "كينوا", "Pomegranate, baby tomato, lemon confit dressing.", "رمان، طماطم صغيرة، صلصة كونفيت الليمون.", 269, "59 SAR", "/quinoa.jpg", [addOns.sumacChicken, addOns.grilledHalloumi], ["se"], ["vegan"]),

      item("Kale & Cabbage", "كيل وملفوف", "Parmigiano, pine nuts, honey za’atar dressing.", "بارميزان، صنوبر، مزين بالزعتر والعسل.", 371, "59 SAR", "/kale-cabbage.jpg", [addOns.sumacChicken, addOns.grilledHalloumi], ["n", "d", "m", "se"], ["vegetarian"]),
    ]),

    section("Add Ons", "الإضافات", [
      item("Spicy Fried Egg", "بيض مقلي بالصلصة الحارة", "Available as an add-on.", "متوفر كإضافة.", 127, "12 SAR", "/spicy-fried-egg.jpg", [], ["e"], ["vegetarian"]),
      item("Halloumi", "حلومي", "Available as an add-on.", "متوفر كإضافة.", 300, "19 SAR", "/halloumi.jpg", [], ["d", "se"], ["vegetarian"]),
      item("Sumac Chicken", "دجاج بالسماق", "Available as an add-on.", "متوفر كإضافة.", 160, "25 SAR", "/sumac-chicken.jpg", [], ["se"], []),
      item("Smoked Paprika Prawn", "جمبري بالبابريكا المدخنة", "Available as an add-on.", "متوفر كإضافة.", 133, "37 SAR", "/smoked-paprika-prawn.jpg", [], ["sh"], []),
      item("Beef Bacon", "لحم بقري مقدد", "Available as an add-on.", "متوفر كإضافة.", 400, "19 SAR", "/beef-bacon.jpg", [], [], []),
      item("Avocado", "أفوكادو", "Available as an add-on.", "متوفر كإضافة.", 90, "15 SAR", "/avocado.jpg", [], [], ["vegan"]),
      item("Mushrooms", "فطر", "Available as an add-on.", "متوفر كإضافة.", 358, "20 SAR", "/mushrooms.jpg", [], [], ["vegan"]),
      item("Grilled Halloumi", "حلومي مشوي", "Available as an add-on.", "متوفر كإضافة.", 300, "19 SAR", "/halloumi.jpg", [], ["d", "se"], ["vegetarian"]),
    ]),

    section("Plates", "الأطباق الرئيسية", [
      item("Mushroom Toast", "توست الفطر", "Hazelnut salt.", "مع البندق المملح.", 312, "59 SAR", "/mushroom-toast.jpg", [], ["g", "d", "n"], ["vegetarian"]),

      item("Chicken Sliders", "سلايدر برجر دجاج", "Sriracha mayo. Comes as 3 pieces.", "مايونيز السيراتشا. يأتي 3 قطع.", 840, "69 SAR", "/chicken-sliders.jpg", [addOns.extraSlider], ["g", "e", "m", "s", "se"], []),

      item("Popcorn Chicken", "بوب كورن الدجاج", "Spicy mayo.", "مع المايونيز الحار.", 425, "49 SAR", "/popcorn-chicken.jpg", [], ["s", "e", "m", "se"], []),

      item("Truffle Burger", "برجر الكمأة", "Monterrey Jack, truffle mayo.", "مونتيري جاك، مايونيز الكمأة.", 1110, "79 SAR", "/truffle-burger.jpg", [addOns.frites, addOns.truffleSauce, addOns.montereyJack, addOns.extraPatty], ["g", "d", "e", "m"], []),

      item("Rigatoni Pink Sauce", "ريجاتوني بالصلصة الوردية", "Basil, chili, parmigiano.", "ريحان، فلفل حار، بارميزان.", 560, "72 SAR", "/rigatoni-pink-sauce.jpg", [addOns.chicken, addOns.prawns, addOns.parmesan], ["g", "d"], ["vegetarian"]),

      item("Cajun Chicken", "دجاج كاجون المشوي", "Free range grilled cajun chicken, corn, tomatoes.", "دجاج كاجون مشوي، ذرة، طماطم.", 767, "75 SAR", "/cajun-chicken.jpg", [], ["d", "m"], []),

      item("Corn & White Truffle Risotto", "ريزوتو مع الكمأة والذرة", "Creamy risotto with white truffle.", "ريزوتو كريمي مع الكمأة البيضاء والذرة.", 510, "99 SAR", "/truffle-risotto.jpg", [addOns.sumacChickenRisotto, addOns.prawnsRisotto], ["d"], ["vegetarian"]),

      item("Black Angus Steak Au Poivre", "بلاك أنجوس ستيك بالفلفل الأسود", "Creamy pepper sauce.", "صلصة الفلفل الكريمية.", 897, "120 SAR", "/black-angus-steak.jpg", [addOns.asparagus, addOns.houseSalad, addOns.frites, addOns.avocado], ["d"], []),

      item("Spaghetti Carbonara", "معكرونة كاربونارا", "Beef bacon, parmesan.", "بيكون لحم بقري، بارميزان.", 932, "69 SAR", "/carbonara.jpg", [], ["g", "d", "e"], []),
    ]),

    section("Sweets", "حلى", [
      item("Greek Yogurt", "زبادي يوناني", "House granola, raspberry, caramel toast.", "جرانولا، توت، توست بالكراميل.", 817, "52 SAR", "/greek-yogurt.jpg", [], ["g", "d", "n"], ["vegetarian"]),

      item("Crushed Milk Chocolate Cookies", "كوكيز شوكولاتة الحليب المطحون", "Frosties soft serve.", "فروستيز ناعم.", 1067, "62 SAR", "/cookies.jpg", [], ["g", "d", "e"], ["vegetarian"]),

      item("Speculoos French Toast", "سبشلوس فرنش توست", "Raspberries, clotted cream. Allow 10 minutes.", "مع التوت والكريمة الثقيلة. يحتاج 10 دقائق.", 462, "55 SAR", "/frenchtoast.jpg", [addOns.darkChocolate, addOns.maple], ["g", "d", "e"], ["vegetarian"]),

      item("Ricotta Pancakes", "فطائر ريكوتا", "Dulce de leche, banana.", "دولسي دي ليتشي مع الموز.", 840, "59 SAR", "/pancakes.jpg", [addOns.darkChocolate, addOns.maple, addOns.dulce], ["g", "d", "e"], ["vegetarian"]),
    ]),

    section("Sides", "الأطباق الجانبية", [
      item("Avocado With Smoked Sea Salt", "أفوكادو مع ملح البحر المدخن", "Side order.", "طبق جانبي.", 90, "15 SAR", "/avocado.jpg", [], [], ["vegan"]),
      item("House Salad With Hazelnut Salt", "سلطة المنزل مع ملح البندق", "Side order.", "طبق جانبي.", 249, "29 SAR", "/house-salad.jpg", [], ["s", "n"], ["vegan"]),
      item("Truffled Mac & Cheese", "ترفل ماك أند تشيز", "Side order.", "طبق جانبي.", 1113, "79 SAR", "/truffled-mac-cheese.jpg", [], ["g", "d"], ["vegetarian"]),
      item("Frites", "بطاطس مقلية", "Side order.", "طبق جانبي.", 312, "25 SAR", "/frites.jpg", [addOns.truffleSauce], [], ["vegan"]),
      item("Asparagus & Toasted Hazelnuts", "الهليون والبندق المحمص", "Side order.", "طبق جانبي.", 131, "39 SAR", "/asparagus.jpg", [], ["n"], ["vegan"]),
    ]),
  ],

    daytime: [
    section("Nibbles", "المقبلات", [
      item("Olives", "زيتون", "Simple, bright and savoury.", "زيتون.", 115, "16 SAR", "/olives.jpg", [], [], ["vegan"]),
      item("Beetroot Hummus & Feta", "حمص بالشمندر مع الفيتا", "Beetroot hummus with feta.", "حمص بالشمندر مع جبنة الفيتا.", 579, "29 SAR", "/beetroot-hummus.jpg", [addOns.pita, addOns.sourdough], ["g", "d", "se"], ["vegetarian"]),
      item("Halloumi Fries", "أصابع الحلومي", "Honey sriracha.", "مع عسل السيراتشا.", 721, "39 SAR", "/halloumi-fries.jpg", [], ["d", "se"], ["vegetarian"]),
    ]),

    section("Small Plates To Share", "أطباق مشاركة صغيرة", [
      item("Crushed Burrata", "بوراتا مسحوقة", "Cherry tomato, smoked salt.", "طماطم كرزية مع ملح مدخن.", 465, "79 SAR", "/crushed-burrata.jpg", [addOns.pita], ["d"], ["vegetarian"]),
      item("Mushroom Toast", "توست الفطر", "Hazelnut salt.", "مع البندق المملح.", 312, "59 SAR", "/mushroom-toast.jpg", [], ["g", "d", "n"], ["vegetarian"]),
      item("Chicken Sliders", "سلايدر برجر دجاج", "Sriracha mayo. Comes as 3 pieces.", "مايونيز السيراتشا. يأتي 3 قطع.", 840, "69 SAR", "/chicken-sliders.jpg", [addOns.extraSlider], ["g", "e", "m", "s", "se"], []),
      item("Honey Sweet Potato", "بطاطا حلوة بالعسل", "Black pepper yogurt, zhoug.", "زبادي بالفلفل الأسود، زحوق.", 280, "42 SAR", "/honey-sweet-potato.jpg", [], ["d", "se"], ["vegetarian"]),
      item("Flamed Aubergine", "فليمد باذنجان", "Miso, crispy rice, greek yogurt.", "ميسو، أرز مقرمش، الزبادي اليوناني.", 535, "45 SAR", "/flamed-aubergine.jpg", [], ["g", "s", "d", "su", "se"], ["vegetarian"]),
      item("Popcorn Chicken", "بوب كورن الدجاج", "Spicy mayo.", "مع المايونيز الحار.", 425, "49 SAR", "/popcorn-chicken.jpg", [], ["s", "e", "m", "se"], []),
      item("Avocado Toast", "توست الأفوكادو", "Feta, coriander pesto.", "جبنة الفيتا، بيستو الكزبرة.", 442, "59 SAR", "/avocado-toast.jpg", [addOns.grilledHalloumi], ["g", "d", "n"], ["vegetarian"]),
    ]),

    section("Salads", "سلطات", [
      item("Quinoa", "كينوا", "Pomegranate, baby tomato, lemon confit dressing.", "رمان، طماطم صغيرة، صلصة كونفيت الليمون.", 269, "59 SAR", "/quinoa.jpg", [addOns.sumacChicken, addOns.grilledHalloumi], ["se"], ["vegan"]),
      item("Kale & Cabbage", "كيل وملفوف", "Parmigiano, pine nuts, golden raisins, honey za’atar dressing.", "بارميزان، صنوبر، زبيب، صلصة الزعتر والعسل.", 371, "59 SAR", "/kale-cabbage.jpg", [addOns.sumacChicken, addOns.grilledHalloumi], ["g", "m", "n", "se"], ["vegetarian"]),
      item("Radicchio Salad", "سلطة راديكيو", "Radicchio, iceberg, walnut, lemon chili dressing.", "راديكيو وخس آيسبرغ، جوز، صلصة ليمون حار.", 373, "39 SAR", "/radicchio.jpg", [], ["n"], ["vegan"]),
    ]),

    section("Add Ons", "الإضافات", [
      item("Spicy Fried Egg", "بيض مقلي بالصلصة الحارة", "Available as an add-on.", "متوفر كإضافة.", 127, "12 SAR", "/spicy-fried-egg.jpg", [], ["e"], ["vegetarian"]),
      item("Halloumi", "حلومي", "Available as an add-on.", "متوفر كإضافة.", 300, "19 SAR", "/halloumi.jpg", [], ["d", "se"], ["vegetarian"]),
      item("Sumac Chicken", "دجاج بالسماق", "Available as an add-on.", "متوفر كإضافة.", 160, "25 SAR", "/sumac-chicken.jpg", [], ["se"], []),
      item("Smoked Paprika Prawn", "جمبري بالبابريكا المدخنة", "Available as an add-on.", "متوفر كإضافة.", 133, "37 SAR", "/smoked-paprika-prawn.jpg", [], ["sh"], []),
      item("Beef Bacon", "لحم بقري مقدد", "Available as an add-on.", "متوفر كإضافة.", 400, "19 SAR", "/beef-bacon.jpg", [], [], []),
      item("Avocado", "أفوكادو", "Available as an add-on.", "متوفر كإضافة.", 90, "15 SAR", "/avocado.jpg", [], [], ["vegan"]),
      item("Mushrooms", "فطر", "Available as an add-on.", "متوفر كإضافة.", 358, "20 SAR", "/mushrooms.jpg", [], [], ["vegan"]),
      item("Grilled Halloumi", "حلومي مشوي", "Available as an add-on.", "متوفر كإضافة.", 300, "19 SAR", "/halloumi.jpg", [], ["d", "se"], ["vegetarian"]),
    ]),

    section("Mains", "الأطباق الرئيسية", [
      item("Rigatoni Pink Sauce", "ريجاتوني بالصلصة الوردية", "Basil, chili, parmigiano.", "ريحان، فلفل حار، بارميزان.", 560, "72 SAR", "/rigatoni-pink-sauce.jpg", [addOns.chicken, addOns.prawns, addOns.parmesan], ["g", "d"], ["vegetarian"]),
      item("Cajun Chicken", "دجاج كاجون المشوي", "Free range grilled cajun chicken, corn, tomatoes.", "دجاج كاجون مشوي، ذرة، طماطم.", 767, "75 SAR", "/cajun-chicken.jpg", [], ["d", "m"], []),
      item("Truffle Burger", "برجر الكمأة", "Monterrey Jack, truffle mayo.", "مونتيري جاك، مايونيز الكمأة.", 1110, "79 SAR", "/truffle-burger.jpg", [addOns.frites, addOns.truffleSauce, addOns.montereyJack,  addOns.extraPatty], ["g", "d", "e", "m"], []),
      item("Corn & White Truffle Risotto", "ريزوتو مع الكمأة والذرة", "Creamy risotto with white truffle.", "ريزوتو كريمي مع الكمأة البيضاء والذرة.", 510, "99 SAR", "/truffle-risotto.jpg", [addOns.sumacChickenRisotto, addOns.prawnsRisotto], ["d"], ["vegetarian"]),
      item("Black Angus Steak Au Poivre", "بلاك أنجوس ستيك بالفلفل الأسود", "Pepper sauce.", "صلصة الفلفل.", 897, "120 SAR", "/black-angus-steak.jpg", [addOns.asparagus, addOns.houseSalad, addOns.frites, addOns.avocado], ["d"], []),
      item("Spaghetti Carbonara", "معكرونة كاربونارا", "Beef bacon, parmesan.", "بيكون لحم بقري، بارميزان.", 932, "69 SAR", "/carbonara.jpg", [], ["g", "d", "e"], []),
    ]),

    section("Sides", "الأطباق الجانبية", [
      item("Avocado With Smoked Sea Salt", "أفوكادو مع ملح البحر المدخن", "Side order.", "طبق جانبي.", 90, "15 SAR", "/avocado.jpg", [], [], ["vegan"]),
      item("Frites", "بطاطس مقلية", "Side order.", "طبق جانبي.", 312, "25 SAR", "/frites.jpg", [addOns.truffleSauce], [], ["vegan"]),
      item("House Salad With Hazelnut Salt", "سلطة المنزل مع ملح البندق", "Side order.", "طبق جانبي.", 249, "29 SAR", "/house-salad.jpg", [], ["s", "n"], ["vegan"]),
      item("Truffled Mac & Cheese", "ترفل ماك أند تشيز", "Side order.", "طبق جانبي.", 1113, "79 SAR", "/truffled-mac-cheese.jpg", [], ["g", "d"], ["vegetarian"]),
      item("Asparagus & Toasted Hazelnuts", "الهليون والبندق المحمص", "Side order.", "طبق جانبي.", 131, "39 SAR", "/asparagus.jpg", [], ["n"], ["vegan"]),
       ]),
  ],
  evening: [
  section("Nibbles", "المقبلات", [
    item("Olives", "زيتون", "Simple, bright and savoury.", "زيتون.", 115, "16 SAR", "/olives.jpg", [], [], ["vegan"]),
    item("Beetroot Hummus & Feta", "حمص بالشمندر مع الفيتا", "Beetroot hummus with feta.", "حمص بالشمندر مع جبنة الفيتا.", 579, "29 SAR", "/beetroot-hummus.jpg", [addOns.pita, addOns.sourdough], ["g", "d", "se"], ["vegetarian"]),
    item("Halloumi Fries", "أصابع الحلومي", "Honey sriracha.", "مع عسل السيراتشا.", 721, "39 SAR", "/halloumi-fries.jpg", [], ["d", "se"], ["vegetarian"]),
  ]),

  section("Salads", "سلطات", [
    item("Kale & Cabbage", "كيل وملفوف", "Parmigiano, pine nuts, golden raisins, honey za’atar dressing.", "بارميزان، صنوبر، زبيب، صلصة الزعتر والعسل.", 371, "45 SAR", "/kale-cabbage.jpg", [addOns.sumacChicken, addOns.grilledHalloumi], ["g", "m", "n", "se"], ["vegetarian"]),
    item("Quinoa", "كينوا", "Pomegranate, baby tomato, lemon confit dressing.", "رمان، طماطم صغيرة، صلصة كونفيت الليمون.", 269, "45 SAR", "/quinoa.jpg", [addOns.sumacChicken, addOns.grilledHalloumi], ["se"], ["vegan"]),
  ]),

  section("Small Plates To Share", "أطباق مشاركة صغيرة", [
    item("Chicken Sliders", "سلايدر برجر دجاج", "Sriracha mayo. Comes as 3 pieces.", "مايونيز السيراتشا. يأتي 3 قطع.", 840, "69 SAR", "/chicken-sliders.jpg", [addOns.extraSlider], ["g", "e", "m", "s", "se"], []),
    item("Honey Sweet Potato", "بطاطا حلوة بالعسل", "Black pepper yogurt, zhoug.", "زبادي بالفلفل الأسود، زحوق.", 280, "42 SAR", "/honey-sweet-potato.jpg", [], ["d", "se"], ["vegetarian"]),
    item("Flamed Aubergine", "فليمد باذنجان", "Miso, crispy rice, greek yogurt.", "ميسو، أرز مقرمش، الزبادي اليوناني.", 535, "45 SAR", "/flamed-aubergine.jpg", [], ["g", "s", "d", "su", "se"], ["vegetarian"]),
    item("Popcorn Chicken", "بوب كورن الدجاج", "Spicy mayo.", "مع المايونيز الحار.", 425, "49 SAR", "/popcorn-chicken.jpg", [], ["s", "e", "m", "se"], []),
    item("Crushed Burrata", "بوراتا مسحوقة", "Cherry tomatoes, smoked salt.", "طماطم كرزية مع ملح مدخن.", 465, "79 SAR", "/crushed-burrata.jpg", [addOns.pita], ["d"], ["vegetarian"]),
  ]),

  section("Mains", "الأطباق الرئيسية", [
    item("Rigatoni Pink Sauce", "ريجاتوني بالصلصة الوردية", "Basil, chili, parmigiano.", "ريحان، فلفل حار، بارميزان.", 560, "72 SAR", "/rigatoni-pink-sauce.jpg", [addOns.chicken, addOns.prawns, addOns.parmesan], ["g", "d"], ["vegetarian"]),
    item("Cajun Chicken", "دجاج كاجون المشوي", "Free range grilled cajun chicken, corn, tomatoes.", "دجاج كاجون مشوي، ذرة، طماطم.", 767, "75 SAR", "/cajun-chicken.jpg", [], ["d", "m"], []),
    item("Truffle Burger", "برجر الكمأة", "Monterrey Jack, truffle mayo.", "مونتيري جاك، مايونيز الكمأة.", 1110, "79 SAR", "/truffle-burger.jpg", [addOns.frites, addOns.truffleSauce, addOns.montereyJack, addOns.extraPatty], ["g", "d", "e", "m"], []),
    item("Corn & White Truffle Risotto", "ريزوتو مع الكمأة والذرة", "Creamy risotto with white truffle.", "ريزوتو كريمي مع الكمأة البيضاء والذرة.", 510, "99 SAR", "/truffle-risotto.jpg", [addOns.sumacChickenRisotto, addOns.prawnsRisotto], ["d"], ["vegetarian"]),
    item("Spaghetti Carbonara", "معكرونة كاربونارا", "Beef bacon, parmesan.", "بيكون لحم بقري، بارميزان.", 932, "69 SAR", "/carbonara.jpg", [], ["g", "d", "e"], []),
item("Black Angus Steak Au Poivre", "بلاك أنجوس ستيك بالفلفل الأسود", "Creamy pepper sauce.", "صلصة الفلفل الكريمية.", 897, "120 SAR", "/black-angus-steak.jpg", [addOns.asparagus, addOns.houseSalad, addOns.frites, addOns.avocado], ["d"], []),
  ]),

  section("Sides", "الأطباق الجانبية", [
    item("Truffled Mac & Cheese", "ترفل ماك أند تشيز", "Side order.", "طبق جانبي.", 1113, "79 SAR", "/truffled-mac-cheese.jpg", [], ["g", "d"], ["vegetarian"]),
    item("Asparagus & Toasted Hazelnuts", "الهليون والبندق المحمص", "Side order.", "طبق جانبي.", 131, "39 SAR", "/asparagus.jpg", [], ["n"], ["vegan"]),
    item("Frites", "بطاطس مقلية", "Side order.", "طبق جانبي.", 312, "25 SAR", "/frites.jpg", [addOns.truffleSauce], [], ["vegan"]),
    item("House Salad With Hazelnut Salt", "سلطة المنزل مع ملح البندق", "Side order.", "طبق جانبي.", 249, "29 SAR", "/house-salad.jpg", [], ["s", "n"], ["vegan"]),
  ]),
],
  desserts: [
    section("Desserts", "حلى", [
      item("Crushed Milk Chocolate Cookies", "كوكيز شوكولاتة الحليب المطحون", "Frosties soft serve.", "فروستيز ناعم.", 1067, "62 SAR", "/cookies.jpg", [], ["g", "d", "e"], ["vegetarian"]),

      item("Churros, Burnt Milk", "شوروز مع الحليب المحروق", "Crispy churros with burnt milk dip.", "شوروز مقرمش مع صوص الحليب المحروق.", 650, "45 SAR", "/churros.jpg", [addOns.darkChocolate], ["g", "d", "e"], ["vegetarian"]),

      item("Speculoos French Toast", "سبشلوس فرنش توست", "Raspberries, clotted cream. Allow 10 minutes.", "مع التوت والكريمة الثقيلة. يحتاج 10 دقائق.", 462, "55 SAR", "/frenchtoast.jpg", [addOns.darkChocolate, addOns.maple], ["g", "d", "e"], ["vegetarian"]),

      item("Strawberry Pistachio Pavlova", "بافلوفا بالفراولة والفستق", "Light meringue with strawberries and pistachio.", "ميرنغ خفيف مع الفراولة والفستق.", 652, "55 SAR", "/pavlova.jpg", [], ["e", "d", "n"], ["vegetarian"]),

      item("Ricotta Pancakes", "فطائر ريكوتا", "Dulce de leche, banana.", "دولسي دي ليتشي مع الموز.", 840, "59 SAR", "/pancakes.jpg", [addOns.darkChocolate, addOns.maple, addOns.dulce], ["g", "d", "e"], ["vegetarian"]),

      item("Affogato", "أفوقاتو", "Espresso poured over soft serve.", "إسبريسو فوق سوفت سيرف.", 400, "39 SAR", "/affogato.jpg", [], ["g", "d", "e"], ["vegetarian"]),
    ]),
  ],
drinks: [
  section("Non Alcoholic Cocktails", "كوكتيلات بدون كحول", [
    item("Apple & Lemon, Lime, Mint", "تفاح وليمون ولايم ونعناع", "", "", "-", "29 SAR", "/menu-icons/apple-lemon-lime-mint.jpg"),
    item("Blackberry & Vanilla, Lemon", "بلاك بيري وفانيلا وليمون", "", "", "-", "29 SAR", "/menu-icons/blackberry-vanilla-lemon.jpg"),
    item("Pineapple & Rosemary, Mint", "أناناس وإكليل الجبل ونعناع", "", "", "-", "29 SAR", "/menu-icons/pineapple-rosemary-mint.jpg"),
    item("Mango & Cardamom, Basil", "مانجو وهيل وريحان", "", "", "-", "29 SAR", "/menu-icons/mango-cardamom-basil.jpg"),
    item("Kumquat, Rosemary & Lemon", "كومكوات وإكليل الجبل وليمون", "", "", "-", "29 SAR", "/menu-icons/lemon-kumquat-rosemary.jpg"),

    item("Passion Fruit Mojito", "موهيتو باشن فروت", "", "", "-", "29 SAR", "/menu-icons/passion-fruit-mojito.jpg"),
    item("Strawberry Mojito", "موهيتو فراولة", "", "", "-", "29 SAR", "/menu-icons/strawberry-mojito.jpg"),
    item("Raspberry Mojito", "موهيتو توت", "", "", "-", "29 SAR", "/menu-icons/raspberry-mojito.jpg"),
    item("Classic Mojito", "موهيتو كلاسيك", "", "", "-", "29 SAR", "/menu-icons/classic-mojito.jpg"),

    item("Watermelon & Mint, Lemon", "بطيخ ونعناع وليمون", "", "", "-", "29 SAR", "/menu-icons/watermelon-mint-lemon.jpg"),

    item("Passion Fruit Lemonade", "ليمونادة باشن فروت", "", "", "-", "29 SAR", "/menu-icons/passion-fruit-lemonade.jpg"),
    item("Raspberry & Cranberry Lemonade", "ليمونادة توت وكرانبيري", "", "", "-", "29 SAR", "/menu-icons/raspberry-cranberry-lemonade.jpg"),
    item("Homemade Basil Lemonade", "ليمونادة ريحان منزلية", "", "", "-", "29 SAR", "/menu-icons/basil-lemonade.jpg"),
    item("Still Homemade Lemonade", "ليمونادة منزلية عادية", "", "", "-", "29 SAR", "/menu-icons/still-homemade-lemonade.jpg"),
    item("Sparkling Homemade Lemonade", "ليمونادة منزلية فوارة", "", "", "-", "29 SAR", "/menu-icons/sparkling-homemade-lemonade.jpg"),

    item("Orange & Pineapple, Almond", "برتقال وأناناس ولوز", "", "", "-", "29 SAR", "/menu-icons/orange-pineapple-almond.jpg"),
  ]),

section("Coffee", "قهوة", [
  item("Espresso", "إسبريسو", "", "", "-", "18 SAR", "/menu-icons/espresso.jpg"),
  item("Macchiato", "ماكياتو", "", "", "-", "18 SAR", "/macchiato.jpg"),
  item("Double Macchiato", "ماكياتو دبل", "", "", "-", "18 SAR", "/double-macchiato.jpg"),
  item("Cortado", "كورتادو", "", "", "-", "22 SAR", "/menu-icons/cortado.jpg", [addOns.milkUpgrade, addOns.vanillaSyrup]),
  item("Americano", "أمريكانو", "", "", "-", "22 SAR", "/menu-icons/americano.jpg", [addOns.vanillaSyrup]),
  item("Latte", "لاتيه", "", "", "-", "24 SAR", "/menu-icons/latte.jpg", [addOns.milkUpgrade, addOns.vanillaSyrup]),
  item("Cappuccino", "كابتشينو", "", "", "-", "24 SAR", "/menu-icons/cappuccino.jpg", [addOns.milkUpgrade, addOns.vanillaSyrup]),
  item("Flat White", "فلات وايت", "", "", "-", "24 SAR", "/menu-icons/flat-white.jpg", [addOns.milkUpgrade, addOns.vanillaSyrup]),
  item("Spanish Latte", "سبانيش لاتيه", "", "", "-", "29 SAR", "/menu-icons/spanish-latte.jpg", [addOns.milkUpgrade, addOns.vanillaSyrup]),
  item("Mocha", "موكا", "", "", "-", "24 SAR", "/menu-icons/mocha.jpg", [addOns.milkUpgrade, addOns.vanillaSyrup]),
  item("Hot Chocolate", "شوكولاتة ساخنة", "", "", "-", "25 SAR", "/menu-icons/hot-chocolate.jpg", [addOns.milkUpgrade, addOns.vanillaSyrup]),
]),

section("Iced Coffee", "قهوة باردة", [
  item("Iced Americano", "أمريكانو بارد", "", "", "-", "22 SAR", "/menu-icons/iced-americano.jpg"),
  item("Iced Latte", "لاتيه بارد", "", "", "-", "24 SAR", "/menu-icons/iced-latte.jpg"),
  item("Iced Mocha", "موكا بارد", "", "", "-", "24 SAR", "/menu-icons/iced-mocha.jpg"),
  item("Coconut Iced Latte", "لاتيه جوز الهند البارد", "", "", "-", "29 SAR", "/menu-icons/coconut-iced-latte.jpg"),
  item("Iced Spanish Latte", "سبانيش لاتيه بارد", "", "", "-", "29 SAR", "/menu-icons/iced-spanish-latte.jpg"),
  item("Toasted Banana Iced Latte", "لاتيه بارد بالموز المحمص", "", "", "-", "29 SAR", "/menu-icons/toasted-banana-iced-latte.jpg"),
]),

section("Tea", "شاي", [
  item("Jasmine Iced Tea", "شاي ياسمين بارد", "", "", "-", "25 SAR", "/menu-icons/jasmine-iced-tea.jpg"),
  item("Jasmine Tea", "شاي ياسمين", "", "", "-", "39 SAR", "/menu-icons/jasmine-tea.jpg"),
  item(
    "Tea Selection",
    "تشكيلة شاي",
    "English Breakfast, Fresh Mint, Peppermint, Chamomile, Green Tea",
    "إنجليزي، نعناع طازج، نعناع، بابونج، شاي أخضر",
    "-",
    "22 SAR",
    "/menu-icons/breakfast-tea.jpg"
  ),
]),
  section("Soft Drinks", "مشروبات غازية", [
  item("Coca Cola", "كوكاكولا", "", "", "-", "16 SAR", "/menu-icons/coca-cola.jpg"),
  item("Coca Cola Light", "كوكاكولا لايت", "", "", "-", "16 SAR", "/menu-icons/coca-cola-light.jpg"),
  item("7 Up", "سفن أب", "", "", "-", "16 SAR", "/menu-icons/seven-up.jpg"),
  item("Apple Juice", "عصير تفاح", "", "", "-", "16 SAR", "/menu-icons/juice-apple.jpg"),
  item("Pineapple Juice", "عصير أناناس", "", "", "-", "16 SAR", "/menu-icons/juice-pineapple.jpg"),
  item("Cranberry Juice", "عصير كرانبيري", "", "", "-", "16 SAR", "/menu-icons/juice-cranberry.jpg"),
  item("Small Sparkling Water", "مياه غازية صغيرة", "", "", "-", "17 SAR", "/menu-icons/small-sparkling-water.jpg"),
  item("Large Sparkling Water", "مياه غازية كبيرة", "", "", "-", "24 SAR", "/menu-icons/large-sparkling-water.jpg"),
  item("Still Water", "مياه عادية", "", "", "-", "24 SAR", "/menu-icons/still-water.jpg"),
]),

 section("Fresh Juices", "عصائر طازجة", [
  item("Orange", "برتقال", "", "", "-", "22 SAR", "/menu-icons/fresh-orange-juice.jpg"),
  item("Apple, Beetroot & Celery", "تفاح و شمندر و كرفس", "", "", "-", "25 SAR", "/menu-icons/apple-beetroot-celery.jpg"),
  item("Apple, Cucumber & Spinach", "تفاح و خيار و سبانخ", "", "", "-", "25 SAR", "/menu-icons/apple-cucumber-spinach.jpg"),
  item("Carrot, Apple & Ginger", "جزر و تفاح و زنجبيل", "", "", "-", "25 SAR", "/menu-icons/carrot-apple-ginger.jpg"),
]),
],
};

function findSectionTitleEnForItem(categoryId, menuItem, menuDataRef) {
  if (!categoryId || !menuItem) return "";
  for (const sec of (menuDataRef || _fallbackMenuData)[categoryId] || []) {
    if (
      sec.items.some(
        (i) => i.en === menuItem.en && i.image === menuItem.image
      )
    ) {
      return sec.title.en;
    }
  }
  return "";
}

const _fallback = { categories: _fallbackCategories, menuData: _fallbackMenuData, addOns, allergenLabels: _fallbackAllergenLabels };

export default function App() {
  const [adminMode, setAdminMode] = useState(false);

  const { categories, menuData: rawMenuData, allergenLabels } = useMenuData(_fallback);
  const menuData = useMemo(() => applyMenuOrdering(rawMenuData), [rawMenuData]);

const [contextualFlow] = useState(() => getContextualFlow());
const [showCategorySelector, setShowCategorySelector] = useState(false);
const [exploreCategory, setExploreCategory] = useState(null);
const [activeCategory, setActiveCategory] = useState(contextualFlow.primary);
const [itemCategoryId, setItemCategoryId] = useState(null);
const [activeItem, setActiveItem] = useState(null);
const [search, setSearch] = useState("");
const dragY = useMotionValue(0);
const dragControls = useDragControls();
const infoOpacity = useTransform(dragY, [0, 70], [1, 0]);
const imageScale = useTransform(dragY, [0, 120], [1, 0.6]);


const [lang, setLang] = useState(() => {
  if (typeof navigator === "undefined") return "en";
  const phoneLang = navigator.language || navigator.userLanguage;
  return phoneLang?.toLowerCase().startsWith("ar") ? "ar" : "en";
});
useEffect(() => {
  const langStats =
    JSON.parse(localStorage.getItem("nacLanguageAnalytics")) || {
      en: 0,
      ar: 0,
    };

  langStats[lang] += 1;

  localStorage.setItem(
    "nacLanguageAnalytics",
    JSON.stringify(langStats)
  );
}, [lang]);
const [activeSection, setActiveSection] = useState("");
const pageViewLogged = useRef(false);
const skipFirstLanguageChange = useRef(true);
const lastSectionEvent = useRef({ cat: null, sec: null });
const timeSpentFired = useRef(false);

useEffect(() => {
  if (pageViewLogged.current) return;
  pageViewLogged.current = true;

  // qr_session_start: fires once per new anonymous session
  if (isNewSession()) {
    trackEvent({
      event_type: "qr_session_start",
      language: lang,
      metadata: { returning: false },
    });
    markSessionLogged();
  } else {
    trackEvent({
      event_type: "qr_session_start",
      language: lang,
      metadata: { returning: true },
    });
  }

  // page_view for initial home load
  trackEvent({
    event_type: "page_view",
    language: lang,
    metadata: { page: "home" },
  });

  // session start time
  getSessionStartTime();

  // time_spent: fire once on page hide or beforeunload
  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden" && !timeSpentFired.current) {
      timeSpentFired.current = true;
      trackTimeSpent(lang);
    }
  };
  const handleBeforeUnload = () => {
    if (!timeSpentFired.current) {
      timeSpentFired.current = true;
      trackTimeSpent(lang);
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

useEffect(() => {
  if (skipFirstLanguageChange.current) {
    skipFirstLanguageChange.current = false;
    return;
  }
  trackEvent({
    event_type: "language_change",
    language: lang,
  });
}, [lang]);
useEffect(() => {

  const preloadCats = exploreCategory
    ? [exploreCategory]
    : showCategorySelector
      ? []
      : contextualFlow.categories;
  if (!preloadCats.length) return;

  const images = preloadCats.flatMap((cat) => menuData[cat] || [])
  .flatMap((sec) => sec.items)
  .flatMap((item) => [
    item.image,
    ...(item.recommended || []).map((rec) => rec.previewImage),
  ])
  .filter(Boolean);

  images.slice(0, 8).forEach((src) => {

    const img = new Image();

    img.src = src;

  });

}, [exploreCategory, showCategorySelector, contextualFlow, menuData]);
const [allergyOpen, setAllergyOpen] = useState(false);
const [selectedAllergens, setSelectedAllergens] = useState([]);
const [selectedDiet, setSelectedDiet] = useState("");
const touchStartX = useRef(0);
const touchEndX = useRef(0);

  const effectiveCategory = exploreCategory || activeCategory;
  const modalCategoryId = itemCategoryId || effectiveCategory;

  const isArabic = lang === "ar";
  const now = new Date();
const currentMinutes = now.getHours() * 60 + now.getMinutes();
const isEveningShift = currentMinutes >= 16 * 60 + 30;

const displayCategories = isEveningShift
  ? [
      categories.find((cat) => cat.id === "evening"),
      categories.find((cat) => cat.id === "drinks"),
      categories.find((cat) => cat.id === "desserts"),
      categories.find((cat) => cat.id === "breakfast"),
      categories.find((cat) => cat.id === "brunch"),
      categories.find((cat) => cat.id === "daytime"),
    ].filter(Boolean)
  : categories;
const toggleAllergen = (code) => {
  setSelectedAllergens((prev) =>
    prev.includes(code)
      ? prev.filter((item) => item !== code)
      : [...prev, code]
  );
};

const isAllowed = (menuItem) => {
  const hasBlockedAllergen = menuItem.allergens?.some((allergen) =>
    selectedAllergens.includes(allergen)
  );

  if (hasBlockedAllergen) return false;

  if (selectedDiet === "vegetarian") {
    return menuItem.tags?.includes("vegetarian") || menuItem.tags?.includes("vegan");
  }

  if (selectedDiet === "vegan") {
    return menuItem.tags?.includes("vegan");
  }

  return true;
};

  const menuCategoryIds = useMemo(
    () =>
      showCategorySelector
        ? []
        : exploreCategory
          ? [exploreCategory]
          : contextualFlow.categories,
    [showCategorySelector, exploreCategory, contextualFlow.categories],
  );

  const itemMatchesFilters = (menuItem) => {
    if (!isAllowed(menuItem)) return false;
    const searchTerm = search.toLowerCase().trim();
    if (!searchTerm) return true;
    const searchableText = `${menuItem.en} ${menuItem.ar} ${menuItem.descEn} ${menuItem.descAr}`.toLowerCase();
    return searchableText.includes(searchTerm);
  };

  const allVisibleItems = menuCategoryIds.flatMap((catId) =>
    (menuData[catId] || []).flatMap((sec) => sec.items.filter(itemMatchesFilters)),
  );

  const contextualNavSections = useMemo(() => {
    if (showCategorySelector) return [];
    const searchTerm = search.toLowerCase().trim();
    return menuCategoryIds.flatMap((catId) =>
      (menuData[catId] || [])
        .map((sec) => ({
          catId,
          title: sec.title,
          items: sec.items.filter((menuItem) => {
            const hasBlockedAllergen = menuItem.allergens?.some((a) => selectedAllergens.includes(a));
            if (hasBlockedAllergen) return false;
            if (selectedDiet === "vegetarian" && !(menuItem.tags?.includes("vegetarian") || menuItem.tags?.includes("vegan"))) {
              return false;
            }
            if (selectedDiet === "vegan" && !menuItem.tags?.includes("vegan")) return false;
            if (!searchTerm) return true;
            const searchableText = `${menuItem.en} ${menuItem.ar} ${menuItem.descEn} ${menuItem.descAr}`.toLowerCase();
            return searchableText.includes(searchTerm);
          }),
        }))
        .filter((sec) => sec.items.length > 0),
    );
  }, [showCategorySelector, menuCategoryIds, menuData, search, selectedAllergens, selectedDiet]);

  const handleSectionNavigate = useCallback(
    (catId, titleEn, domId) => {
      const slug = sectionSlug(titleEn);
      setActiveCategory(catId);
      setActiveSection(domId);
      lastSectionEvent.current = { cat: catId, sec: slug };
      trackEvent({
        event_type: "section_view",
        category_id: catId,
        section_id: slug,
        language: lang,
        metadata: { source: "nav_click" },
      });
    },
    [lang],
  );

  const closeActiveItem = useCallback(
    (reason) => {
      if (!activeItem) {
        setActiveItem(null);
        return;
      }
      const sectionEn = findSectionTitleEnForItem(modalCategoryId, activeItem, menuData);
      const sectionSlug = sectionEn
        ? sectionEn.toLowerCase().replaceAll(" ", "-")
        : null;
      trackEvent({
        event_type: "item_close",
        language: lang,
        category_id: modalCategoryId,
        section_id: sectionSlug,
        item_id:
          modalCategoryId && sectionEn
            ? makeMenuItemId(modalCategoryId, sectionEn, activeItem.en)
            : null,
        item_name_en: activeItem.en,
        item_name_ar: activeItem.ar,
        metadata: { close_reason: reason },
      });
      setActiveItem(null);
    },
    [activeItem, modalCategoryId, lang, menuData]
  );

  const openMenuItem = useCallback(
    (menuItem, sectionTitleEn, categoryIdOverride) => {
      if (!menuItem?.en) return;
      const catId = categoryIdOverride || effectiveCategory;
      if (!catId) return;
      setItemCategoryId(catId);
      dragY.set(0);
      setActiveItem(menuItem);
      const sectionSlug = sectionTitleEn.toLowerCase().replaceAll(" ", "-");
      trackEvent({
        event_type: "item_open",
        language: lang,
        category_id: catId,
        section_id: sectionSlug,
        item_id: makeMenuItemId(catId, sectionTitleEn, menuItem.en),
        item_name_en: menuItem.en,
        item_name_ar: menuItem.ar,
      });
      trackEvent({
        event_type: "page_view",
        language: lang,
        category_id: catId,
        item_name_en: menuItem.en,
        metadata: { page: "item_modal" },
      });
    },
    [effectiveCategory, lang, dragY]
  );

  const handleSwipe = useCallback(() => {
    const diff = touchEndX.current - touchStartX.current;

    if (touchStartX.current > 35) return;

    if (diff > 90) {
      if (activeItem) {
        closeActiveItem("swipe");
      } else if (!showCategorySelector) {
        setShowCategorySelector(true);
      }
    }
  }, [activeItem, showCategorySelector, closeActiveItem]);

const goToNextItem = () => {
  if (!activeItem) return;

  const currentIndex = allVisibleItems.findIndex(
    (i) => i.en === activeItem.en
  );

  const nextIndex =
    (currentIndex + 1) % allVisibleItems.length;

  const nextItem = allVisibleItems[nextIndex];

  trackEvent({
    event_type: "item_navigation",
    language: lang,
    category_id: activeCategory,
    item_name_en: nextItem.en,
    item_name_ar: nextItem.ar,
    metadata: {
      direction: "next",
      from_item: activeItem.en,
      to_item: nextItem.en,
    },
  });

  setActiveItem(nextItem);
};

const goToPrevItem = () => {
  if (!activeItem) return;

  const currentIndex = allVisibleItems.findIndex(
    (i) => i.en === activeItem.en
  );

  const prevIndex =
    (currentIndex - 1 + allVisibleItems.length) %
    allVisibleItems.length;

  const prevItem = allVisibleItems[prevIndex];

  trackEvent({
    event_type: "item_navigation",
    language: lang,
    category_id: activeCategory,
    item_name_en: prevItem.en,
    item_name_ar: prevItem.ar,
    metadata: {
      direction: "previous",
      from_item: activeItem.en,
      to_item: prevItem.en,
    },
  });

  setActiveItem(prevItem);
};

useEffect(() => {
  if (activeItem) {
    dragY.set(0);
  }
}, [activeItem, dragY]);

// Heatmap prep: track max scroll depth per category visit
const maxScrollDepth = useRef(0);
const scrollDepthCategory = useRef(null);

useEffect(() => {
  if (!activeCategory) {
    if (scrollDepthCategory.current && maxScrollDepth.current > 5) {
      trackEvent({
        event_type: "scroll_depth",
        category_id: scrollDepthCategory.current,
        language: lang,
        metadata: { depth_percent: maxScrollDepth.current },
      });
    }
    maxScrollDepth.current = 0;
    scrollDepthCategory.current = null;
    return;
  }
  scrollDepthCategory.current = activeCategory;
  maxScrollDepth.current = 0;

  const trackDepth = () => {
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (docHeight > 0) {
      const pct = Math.round((window.scrollY / docHeight) * 100);
      if (pct > maxScrollDepth.current) maxScrollDepth.current = pct;
    }
  };
  window.addEventListener("scroll", trackDepth, { passive: true });
  return () => window.removeEventListener("scroll", trackDepth);
}, [activeCategory, lang]);

useEffect(() => {
  if (showCategorySelector || contextualNavSections.length === 0) return undefined;

  const handleScroll = () => {
    let current = "";

    contextualNavSections.forEach((sec) => {
      const domId = makeSectionDomId(sec.catId, sec.title.en);
      const el = document.getElementById(domId);
      if (el) {
        const top = el.offsetTop - 160;
        if (window.scrollY >= top) current = domId;
      }
    });

    if (current) setActiveSection(current);
  };

  handleScroll();
  window.addEventListener("scroll", handleScroll, { passive: true });
  return () => window.removeEventListener("scroll", handleScroll);
}, [showCategorySelector, contextualNavSections]);

// Heatmap prep: section visibility duration
const sectionEnterTime = useRef(null);
const lastTrackedSection = useRef(null);

useEffect(() => {
  lastSectionEvent.current = { cat: null, sec: null };
  sectionEnterTime.current = null;
  lastTrackedSection.current = null;
}, [activeCategory]);

useEffect(() => {
  setActiveSection("");
}, [showCategorySelector, exploreCategory, search]);

useEffect(() => {
  if (!activeSection) return;
  const el = document.getElementById(activeSection);
  const slug = el?.dataset?.sectionSlug;
  const catId = el?.dataset?.categoryId;
  if (!slug || !catId) return;

  const now = Date.now();
  if (lastTrackedSection.current && lastTrackedSection.current !== slug && sectionEnterTime.current) {
    const elapsed = Math.round((now - sectionEnterTime.current) / 1000);
    if (elapsed >= 2) {
      trackEvent({
        event_type: "section_visibility_time",
        category_id: catId,
        section_id: lastTrackedSection.current,
        language: lang,
        metadata: { seconds: elapsed },
      });
    }
  }
  lastTrackedSection.current = slug;
  sectionEnterTime.current = now;
}, [activeSection, lang]);

useEffect(() => {
  if (!activeSection) return;
  const el = document.getElementById(activeSection);
  const slug = el?.dataset?.sectionSlug;
  const catId = el?.dataset?.categoryId;
  if (!slug || !catId) return;

  const handle = setTimeout(() => {
    if (lastSectionEvent.current.cat === catId && lastSectionEvent.current.sec === slug) return;
    lastSectionEvent.current = { cat: catId, sec: slug };
    trackEvent({
      event_type: "section_view",
      category_id: catId,
      section_id: slug,
      language: lang,
      metadata: { source: "scroll_spy" },
    });
  }, 600);
  return () => clearTimeout(handle);
}, [activeSection, lang]);

useEffect(() => {
  const q = search.trim();
  if (q.length < 2 || !activeCategory) return;
  const t = setTimeout(() => {
    trackEvent({
      event_type: "search_used",
      search_query: q,
      language: lang,
      category_id: activeCategory,
    });
  }, 500);
  return () => clearTimeout(t);
}, [search, lang, activeCategory]);

if (adminMode) {
  return <AdminDashboard onBack={() => setAdminMode(false)} />;
}
  return (
    <div
  className={`site ${isArabic ? "rtl" : ""}`}
  onTouchStart={(e) => (touchStartX.current = e.changedTouches[0].clientX)}
  onTouchEnd={(e) => {
    touchEndX.current = e.changedTouches[0].clientX;
    handleSwipe();
  }}
>
      <div className="site-top-bar">
        {!showCategorySelector && (
          <button
            type="button"
            className="all-menus-link"
            onClick={() => setShowCategorySelector(true)}
          >
            {isArabic ? "كل القوائم" : "All Menus"}
          </button>
        )}
        <div className="lang-switch">
      <button
  type="button"
  className={lang === "en" ? "active" : ""}
  onClick={() => {
    if (lang === "en") return;
    trackEvent({
      event_type: "language_button_click",
      language: lang,
      metadata: { from: lang, to: "en" },
    });

    setLang("en");
  }}
>
  EN
</button>

<button
  type="button"
  className={lang === "ar" ? "active" : ""}
  onClick={() => {
    if (lang === "ar") return;
    trackEvent({
      event_type: "language_button_click",
      language: lang,
      metadata: { from: lang, to: "ar" },
    });

    setLang("ar");
  }}
>
  AR
</button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showCategorySelector ? (
          <motion.main key="home" className="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28, ease: "easeOut" }}>
            <img src="/logo.png" alt="NAC" className="logo" />
            <button
  className="admin-entry"
  onClick={() => {
    const password = prompt("Enter admin password");

    if (password === "nac2025") {
      setAdminMode(true);
    } else {
      alert("Wrong password");
    }
  }}
>
  Admin
</button>

            <motion.h1 className="branch-title" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
  {isArabic ? "الخبر" : "KHOBAR"}
</motion.h1>

            <motion.div
  className="category-row"
  initial={{ opacity: 0, y: 18 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.45, ease: "easeOut" }}
  variants={{
    hidden: {},
    show: {
      transition: {
        staggerChildren: 0.045,
        delayChildren: 0.08,
      },
    },
  }}
>
              {displayCategories.map((cat, index) => (
                <motion.button
  key={cat.id}
  className="category-card"
  onClick={() => {
  setShowCategorySelector(false);
  setActiveCategory(cat.id);
  setExploreCategory(contextualFlow.categories.includes(cat.id) ? null : cat.id);
  trackEvent({ event_type: "category_open", category_id: cat.id, language: lang });
  trackEvent({ event_type: "page_view", language: lang, category_id: cat.id, metadata: { page: cat.id, explore: !contextualFlow.categories.includes(cat.id) } });
  const categoryAnalytics = JSON.parse(localStorage.getItem("nacCategoryAnalytics")) || {};
  categoryAnalytics[cat.en] = (categoryAnalytics[cat.en] || 0) + 1;
  localStorage.setItem("nacCategoryAnalytics", JSON.stringify(categoryAnalytics));
}}
  initial={{ opacity: 0, y: 30 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{
    delay: index * 0.06,
    duration: 0.45,
    ease: "easeOut",
  }}
  whileHover={{ y: -8, scale: 1.03 }}
  whileTap={{ scale: 0.94 }}
>
                  <CategoryCardPreview
                    category={cat}
                    previewItems={getMenuPreviewItems(cat.id, menuData, 3)}
                    isArabic={isArabic}
                  />
                  <span className="category-card-title">{isArabic ? cat.ar : cat.en}</span>
                  <small className="category-time">
  {isArabic ? cat.timeAr : cat.timeEn}
</small>
                </motion.button>
              ))}
            </motion.div>
          </motion.main>
        ) : (
          <motion.main key="contextual" className="contextual-page menu-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.32 }}>
            <section className="home-hero">
              <img src="/logo.png" alt="NAC" className="logo logo-compact" />
              <motion.h1 className="branch-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                {isArabic ? "الخبر" : "KHOBAR"}
              </motion.h1>
              <p className="contextual-greeting">{getContextualGreeting(contextualFlow, isArabic)}</p>
            </section>

            <input
              type="text"
              className="menu-search"
              onFocus={(e) => e.target.parentElement.classList.add("search-active")}
              onBlur={(e) => e.target.parentElement.classList.remove("search-active")}
              placeholder={isArabic ? "ابحث في القائمة..." : "Search the menu..."}
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                setSearch(value);
                if (value.length > 2) {
                  const searches = JSON.parse(localStorage.getItem("nacSearchAnalytics")) || {};
                  searches[value.toLowerCase()] = (searches[value.toLowerCase()] || 0) + 1;
                  localStorage.setItem("nacSearchAnalytics", JSON.stringify(searches));
                }
              }}
            />

            <div className="allergy-bar">
              <button
                type="button"
                onClick={() => {
                  setAllergyOpen(true);
                  trackEvent({ event_type: "allergy_modal_open", language: lang, category_id: activeCategory });
                }}
              >
                {isArabic ? "الحساسية والتفضيلات" : "Allergies & Preferences"}
              </button>
              {(selectedAllergens.length > 0 || selectedDiet) && (
                <button
                  type="button"
                  className="clear-filter"
                  onClick={() => {
                    trackEvent({
                      event_type: "filter_clear",
                      language: lang,
                      category_id: activeCategory,
                      selected_allergens: selectedAllergens.length > 0 ? [...selectedAllergens] : null,
                      metadata: { diet: selectedDiet || null },
                    });
                    setSelectedAllergens([]);
                    setSelectedDiet("");
                  }}
                >
                  {isArabic ? "مسح الفلتر" : "Clear Filters"}
                </button>
              )}
            </div>

            <ContextualMenuView
              flow={contextualFlow}
              categories={categories}
              menuData={menuData}
              activeCategory={activeCategory}
              setActiveCategory={setActiveCategory}
              isArabic={isArabic}
              lang={lang}
              search={search}
              isAllowed={isAllowed}
              onOpenItem={openMenuItem}
              exploreOnlyCategory={exploreCategory}
              activeSection={activeSection}
              onSectionNavigate={handleSectionNavigate}
              onBackToContextual={() => {
                setExploreCategory(null);
                setActiveCategory(contextualFlow.primary);
              }}
            />

            <p className="footer-note">
              {isArabic
                ? "في حال الحساسية أو عدم التحمل أو لديك متطلبات غذائية خاصة، يرجى التحدث إلى النادل قبل الطلب. جميع الأسعار تتضمن ضريبة القيمة المضافة 15٪."
                : "In case of allergies, intolerances or dietary requirements, please speak to your waiter before ordering. All prices include 15% VAT."}
            </p>
          </motion.main>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {activeItem && (
          <motion.div className="lux-overlay" onClick={() => closeActiveItem("overlay")} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
           <motion.div
  key={activeItem.en}
  className="lux-panel"
  onClick={(e) => e.stopPropagation()}
drag="x"
dragSnapToOrigin
dragConstraints={{ left: 0, right: 0 }}
dragElastic={0.18}
onDragEnd={(e, info) => {
  if (info.offset.x < -55) {
    goToNextItem();
  }

  if (info.offset.x > 55) {
    goToPrevItem();
  }
}}
  
  initial={{ opacity: 0, scale: 0.94 }}
  animate={{ opacity: 1, scale: 1 }}
  exit={{ opacity: 0, scale: 0.9 }}
 transition={{
  type: "spring",
  stiffness: 320,
  damping: 28
}}
>
              <button className="close-icon" onClick={() => closeActiveItem("button")}>
                <X size={20} />
              </button>

             
<motion.div
  className="lux-image"
  transition={{ duration: 0.18, ease: "easeOut" }}
  drag="y"
  dragDirectionLock
  dragControls={dragControls}
  dragListener={false}
  dragConstraints={{ top: 0, bottom: 180 }}
  dragElastic={0.12}
  onPointerDown={(e) => dragControls.start(e)}
  
  style={{ y: dragY, scale: imageScale, touchAction: "none" }}
  onDragEnd={(event, info) => {
    if (info.offset.y > 100 || info.velocity.y > 700) {
      const sectionEn = findSectionTitleEnForItem(
        activeCategory,
        activeItem,
        menuData
      );
      const sectionSlug = sectionEn
        ? sectionEn.toLowerCase().replaceAll(" ", "-")
        : null;
      trackEvent({
        event_type: "modal_drag_close",
        language: lang,
        category_id: modalCategoryId,
        section_id: sectionSlug,
        item_id:
          modalCategoryId && sectionEn
            ? makeMenuItemId(modalCategoryId, sectionEn, activeItem.en)
            : null,
        item_name_en: activeItem?.en,
        item_name_ar: activeItem?.ar,
      });
      closeActiveItem("drag");
    } else {
      dragY.stop();
      dragY.set(0);
    }
  }}
>
  {activeItem.image?.trim() ? (
    <AnimatePresence mode="wait">
      <motion.img
        key={activeItem.image}
        src={activeItem.image}
        alt={activeItem.en}
        initial={{ opacity: 0.15, scale: 1.02 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
      />
    </AnimatePresence>
  ) : (
    <div className="lux-image-placeholder" aria-hidden />
  )}
</motion.div>

              <motion.div className="lux-info" style={{ opacity: infoOpacity }}>
                <p className="lux-label">NAC KHOBAR</p>
                <h1>{isArabic ? activeItem.ar : activeItem.en}</h1>
                <p>{isArabic ? activeItem.descAr : activeItem.descEn}</p>

                <div className="meta">
                  {activeItem.calories !== "-" && <span>{activeItem.calories} cal</span>}
                  <span>{activeItem.price}</span>
                </div>
                {activeItem.allergens?.length > 0 && (
  <div className="allergen-chips">
    {activeItem.allergens.map((code) => (
      <span key={code}>
        {isArabic ? allergenLabels[code]?.ar : allergenLabels[code]?.en}
      </span>
    ))}
  </div>
)}

                {activeItem.recommended?.length > 0 && (
                  <div className="recommended-box">
                    <h4>{isArabic ? "إضافات مقترحة" : "Recommended Add-ons"}</h4>
                    {activeItem.recommended
  .filter((rec) => !selectedAllergens.some(a => rec.allergens?.includes(a)))
  .map((rec) => (
                      <div
  className={`addon-row ${rec.previewImage ? "clickable-addon" : ""}`}
  key={`${rec.en}-${rec.previewImage || rec.price}`}
onClick={(e) => {
  e.stopPropagation();

  const addonAnalytics =
    JSON.parse(localStorage.getItem("nacAddonAnalytics")) || {};

  addonAnalytics[rec.en] =
    (addonAnalytics[rec.en] || 0) + 1;

  localStorage.setItem(
    "nacAddonAnalytics",
    JSON.stringify(addonAnalytics)
  );

  trackEvent({
    event_type: "add_on_click",
    language: lang,
    category_id: activeCategory,
    item_id: activeCategory
      ? makeMenuItemId(
          activeCategory,
          findSectionTitleEnForItem(modalCategoryId, activeItem, menuData),
          activeItem.en
        )
      : null,
    item_name_en: activeItem.en,
    item_name_ar: activeItem.ar,
    add_on_name: rec.en,
    metadata: { add_on_name_ar: rec.ar },
  });
const addonConversions =
  JSON.parse(localStorage.getItem("nacAddonConversions")) || {};

const itemKey = activeItem.en;
const addonKey = rec.en;

if (!addonConversions[itemKey]) {
  addonConversions[itemKey] = {};
}

addonConversions[itemKey][addonKey] =
  (addonConversions[itemKey][addonKey] || 0) + 1;

localStorage.setItem(
  "nacAddonConversions",
  JSON.stringify(addonConversions)
);
  if (rec.previewImage) {
    trackEvent({
      event_type: "addon_preview_view",
      language: lang,
      category_id: activeCategory,
      item_name_en: activeItem.en,
      item_name_ar: activeItem.ar,
      add_on_name: rec.en,
      metadata: {
        preview_image: rec.previewImage,
      },
    });
    setActiveItem({
      ...activeItem,
      image:
        activeItem.image === rec.previewImage
          ? activeItem.originalImage || activeItem.image
          : rec.previewImage,
      originalImage: activeItem.originalImage || activeItem.image,
    });
  }
}}
>
                        <div>
                          <span>{isArabic ? rec.ar : rec.en}</span>
                          {rec.calories && rec.calories !== "-" && (
  <small>{rec.calories} cal</small>
)}
                        </div>
                        <strong>+{rec.price}</strong>
                      </div>
                    ))}
                  </div>
                )}

                <button onClick={() => closeActiveItem("button")}>
                  {isArabic ? "إغلاق" : "Close"}
                </button>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
</AnimatePresence>
  {allergyOpen && (
    <motion.div
      className="lux-overlay"
      onClick={() => setAllergyOpen(false)}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="allergy-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.92, y: 30 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 40 }}
      >
        <button className="close-icon" onClick={() => setAllergyOpen(false)}>
          <X size={20} />
        </button>

        <h2>{isArabic ? "الحساسية والتفضيلات" : "Allergies & Preferences"}</h2>
        <p>
  {isArabic
    ? "اختر ما تريد تجنبه، وسيتم عرض الأصناف المناسبة فقط."
    : "Select what you want to avoid, and the menu will show suitable items only."}
</p>

<h4>{isArabic ? "الحساسية" : "Allergens"}</h4>

<div className="filter-grid">
  {Object.entries(allergenLabels).map(([code, label]) => (
    <button
      key={code}
      className={selectedAllergens.includes(code) ? "selected" : ""}
      onClick={() => toggleAllergen(code)}
    >
      {isArabic ? label.ar : label.en}
    </button>
  ))}
</div>

<h4>{isArabic ? "التفضيلات" : "Preferences"}</h4>

<div className="filter-grid">
  <button
    className={selectedDiet === "vegetarian" ? "selected" : ""}
    onClick={() =>
      setSelectedDiet(selectedDiet === "vegetarian" ? "" : "vegetarian")
    }
  >
    {isArabic ? "نباتي" : "Vegetarian"}
  </button>

  <button
    className={selectedDiet === "vegan" ? "selected" : ""}
    onClick={() =>
      setSelectedDiet(selectedDiet === "vegan" ? "" : "vegan")
    }
  >
    {isArabic ? "نباتي بالكامل" : "Vegan"}
  </button>
</div>

<p className="allergy-disclaimer">
  {isArabic
    ? "هذا الفلتر إرشادي فقط. يرجى إبلاغ النادل عن أي حساسية قبل الطلب."
    : "This filter is a guide only. Please inform your waiter about any allergies before ordering."}
</p>

<button
  className="apply-filter"
  onClick={() => {
    trackEvent({
      event_type: "allergen_filter_used",
      language: lang,
      category_id: activeCategory,
      selected_allergens:
        selectedAllergens.length > 0 ? [...selectedAllergens] : null,
      metadata: {
        diet: selectedDiet || null,
      },
    });
    setAllergyOpen(false);
  }}
>
  {isArabic ? "تطبيق" : "Apply"}
</button>
      </motion.div>
    </motion.div>
  )}
    </div>
  );
}