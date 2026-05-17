-- ============================================================
-- NAC MENU OS — Complete Seed Data
-- Run AFTER menu_schema.sql
-- Idempotent: safe to re-run
-- ============================================================

TRUNCATE categories, sections, menu_items, add_ons, item_addons, allergens, item_allergens CASCADE;

-- 1. ALLERGENS
INSERT INTO allergens (code, name_en, name_ar) VALUES
  ('g', 'Gluten', 'جلوتين'),
  ('d', 'Dairy', 'ألبان'),
  ('e', 'Eggs', 'بيض'),
  ('n', 'Nuts', 'مكسرات'),
  ('se', 'Sesame', 'سمسم'),
  ('m', 'Mustard', 'خردل'),
  ('s', 'Soya', 'صويا'),
  ('sh', 'Shellfish', 'محار'),
  ('f', 'Fish', 'سمك'),
  ('su', 'Sulphites', 'كبريتيت');

-- 2. CATEGORIES
INSERT INTO categories (slug, name_en, name_ar, icon, icon_ar, time_en, time_ar, sort_order) VALUES
  ('brunch', 'Brunch', 'برانش', '/menu-icons/brunch.png', '/menu-icons-ar/brunch.png', 'Fri & Sat · 12–5 PM', 'الجمعة والسبت · ١٢–٥ م', 1),
  ('daytime', 'Daytime', 'النهار', '/menu-icons/daytime.png', '/menu-icons-ar/daytime.png', 'Sun–Thu · 12–5 PM', 'الأحد–الخميس · ١٢–٥ م', 2),
  ('breakfast', 'Breakfast', 'الفطور', '/menu-icons/breakfast.jpeg', '/menu-icons-ar/Breakfast.png', '9–12 AM', '٩–١٢ ص', 3),
  ('evening', 'Evening Menu', 'المساء', '/menu-icons/evening.png', '/menu-icons-ar/dinner.png', '5–11:30 PM', '٥–١١:٣٠ م', 4),
  ('desserts', 'Desserts', 'حلى', '/menu-icons/desserts.png', '/menu-icons-ar/dessert.png', 'All Day', 'طوال اليوم', 5),
  ('drinks', 'Drinks', 'مشروبات', '/menu-icons/drinks.png', '/menu-icons-ar/drinks.png', 'All Day', 'طوال اليوم', 6);

-- 3. ADD-ONS
INSERT INTO add_ons (slug, name_en, name_ar, price, calories, preview_image) VALUES
  ('chicken', 'Add Chicken', 'إضافة دجاج', '25 SAR', '160', '/rigatoni-pink-sauce-chicken.jpg'),
  ('prawns', 'Add Smoked Paprika Prawn', 'إضافة جمبري بالبابريكا المدخنة', '37 SAR', '133', '/rigatoni-pink-sauce-prawn.jpg'),
  ('prawnsRisotto', 'Add Smoked Paprika Prawn', 'إضافة جمبري بالبابريكا المدخنة', '37 SAR', '133', '/truffle-risotto-prawn.jpg'),
  ('truffleSauce', 'Truffle Sauce', 'صلصة الكمأة', '8 SAR', '-', ''),
  ('extraPatty', 'Extra Patty', 'قطعة لحم إضافية', '33 SAR', '-', ''),
  ('asparagus', 'Asparagus & Toasted Hazelnuts', 'الهليون والبندق المحمص', '39 SAR', '131', ''),
  ('houseSalad', 'House Salad', 'سلطة المنزل', '29 SAR', '249', ''),
  ('frites', 'Frites', 'بطاطس مقلية', '25 SAR', '312', ''),
  ('grilledHalloumi', 'Grilled Halloumi', 'حلومي مشوي', '19 SAR', '300', ''),
  ('sumacChicken', 'Sumac Chicken', 'دجاج بالسماق', '25 SAR', '160', ''),
  ('extraSlider', 'Additional Slider Piece', 'قطعة سلايدر إضافية', '19 SAR', '-', ''),
  ('darkChocolate', 'Dark Chocolate', 'شوكولاتة داكنة', '6 SAR', '-', ''),
  ('pita', 'Pita Bread', 'خبز بيتا', '6 SAR', '-', ''),
  ('sourdough', 'Sourdough Bread', 'خبز ساوردو', '6 SAR', '-', ''),
  ('montereyJack', 'Monterey Jack Cheese', 'جبنة مونتيري جاك', '8 SAR', '-', ''),
  ('beefBacon', 'Beef Bacon', 'لحم بقري مقدد', '19 SAR', '400', ''),
  ('avocado', 'Avocado Slices', 'شرائح أفوكادو', '15 SAR', '90', ''),
  ('mushrooms', 'Mushrooms', 'فطر', '20 SAR', '358', ''),
  ('parmesan', 'Extra Parmesan Cheese', 'إضافة جبنة بارميزان', '8 SAR', '-', ''),
  ('maple', 'Extra Maple Syrup', 'إضافة شراب القيقب', '6 SAR', '-', ''),
  ('dulce', 'Extra Dulce de Leche', '...', '6 SAR', '-', ''),
  ('sumacChickenRisotto', 'Add Sumac Chicken', 'إضافة دجاج بالسماق', '25 SAR', '160', '/truffle-risotto-chicken.jpg'),
  ('milkUpgrade', 'Milk Upgrade (Almond, Oat, Coconut)', 'تبديل الحليب (لوز، شوفان، جوز الهند)', '6 SAR', '-', ''),
  ('vanillaSyrup', 'Vanilla Syrup', 'شراب الفانيلا', '6 SAR', '-', '');

-- 4. SECTIONS & ITEMS (using DO block for referencing IDs)
DO $$
DECLARE
  cat_breakfast UUID;
  cat_brunch UUID;
  cat_daytime UUID;
  cat_evening UUID;
  cat_desserts UUID;
  cat_drinks UUID;
  sec_id UUID;
  item_id UUID;
BEGIN
  SELECT id INTO cat_breakfast FROM categories WHERE slug = 'breakfast';
  SELECT id INTO cat_brunch FROM categories WHERE slug = 'brunch';
  SELECT id INTO cat_daytime FROM categories WHERE slug = 'daytime';
  SELECT id INTO cat_evening FROM categories WHERE slug = 'evening';
  SELECT id INTO cat_desserts FROM categories WHERE slug = 'desserts';
  SELECT id INTO cat_drinks FROM categories WHERE slug = 'drinks';

  -- ═══════════════════════════════════════════════════════════
  -- BREAKFAST
  -- ═══════════════════════════════════════════════════════════

  -- Grains
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_breakfast, 'Grains', 'الحبوب', 1) RETURNING id INTO sec_id;
  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Greek Yogurt', 'زبادي يوناني', 'House granola, raspberries, caramel toast.', 'جرانولا منزلية، توت، توست كراميل.', '817', '52 SAR', '/greek-yogurt.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','n');

  -- Eggs
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_breakfast, 'Eggs', 'البيض', 2) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, '2 Eggs Any Style', '٢ بيض من أي نوع', 'Fried, scrambled or poached.', 'مقلي، مخفوق أو مسلوق.', '461.4', '31 SAR', '/2-eggs.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e','g');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='beefBacon'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='avocado'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='mushrooms'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='montereyJack'), 4);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Scrambled Eggs', 'بيض مخفوق', 'Monterrey Jack, jalapeño mayo, brioche bun.', 'مونتيري جاك، مايونيز هلابينو، خبزة البريوش.', '751', '49 SAR', '/scrambled-eggs.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Turkish Eggs', 'بيض تركي', 'Cajun butter, pita.', 'زبدة كاجون، بيتا.', '698', '49 SAR', '/turkish-eggs.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='sourdough'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Shakshuka', 'شكشوكة', 'Baked eggs, feta, za''atar, pita.', 'بيض مخبوز، جبنة الفيتا، زعتر، بيتا.', '575', '49 SAR', '/shakshuka.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e','g','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='sourdough'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Poached Eggs & Avocado Toast', 'بيض مسلوق مع توست أفوكادو', 'Feta, coriander pesto.', 'جبنة فيتا، بيستو الكزبرة.', '638', '65 SAR', '/poached-eggs-avocado.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e','g','d');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Mediterranean Breakfast', 'إفطار البحر الأبيض المتوسط', 'Fried eggs, tzatziki, avocado, tomato, cucumber, red onion salad, baby peppers, halloumi and pita.', 'بيض مقلي، تزاتزيكي، أفوكادو، سلطة طماطم وخيار وبصل أحمر، فلفل صغير، حلومي وبيتا.', '898', '69 SAR', '/mediterranean-breakfast.jpg', true, 6) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e','d','g','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='sourdough'), 2);

  -- Sweets
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_breakfast, 'Sweets', 'حلى', 3) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Daily Pastries Basket', 'سلة المعجنات', 'Fresh pastries basket.', 'سلة معجنات طازجة.', '1162', '39 SAR', '/pastries-basket.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Crushed Milk Chocolate Cookies', 'كوكيز شوكولاتة الحليب المطحون', 'Frosties soft serve.', 'فروستيز ناعم.', '1067', '62 SAR', '/cookies.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Speculoos French Toast', 'سبشلوس فرنش توست', 'Raspberries, clotted cream. Allow 10 minutes.', 'مع التوت والكريمة الثقيلة. يحتاج 10 دقائق.', '462', '55 SAR', '/frenchtoast.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='darkChocolate'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='maple'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Ricotta Pancakes', 'فطائر ريكوتا', 'Dulce de leche, banana.', 'دولسي دي ليتشي مع الموز.', '840', '59 SAR', '/pancakes.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='darkChocolate'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='maple'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='dulce'), 3);

  -- Sides
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_breakfast, 'Sides', 'الأطباق الجانبية', 4) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Mushrooms', 'فطر', 'Breakfast side.', 'طبق جانبي للفطور.', '358', '20 SAR', '/mushrooms.jpg', true, 1);
  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Beef Bacon', 'لحم بقري مقدد', 'Breakfast side.', 'طبق جانبي للفطور.', '400', '19 SAR', '/beef-bacon.jpg', 2);
  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Avocado', 'أفوكادو', 'Breakfast side.', 'طبق جانبي للفطور.', '90', '15 SAR', '/avocado.jpg', true, 3);
  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Halloumi', 'حلومي', 'Breakfast side.', 'طبق جانبي للفطور.', '721', '19 SAR', '/halloumi.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  -- Plates
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_breakfast, 'Plates', 'الأطباق الرئيسية', 5) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Mushroom Toast', 'توست الفطر', 'Hazelnut salt.', 'مع البندق المملح.', '312', '59 SAR', '/mushroom-toast.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Chicken Sliders', 'سلايدر برجر دجاج', 'Sriracha mayo. Comes as 3 pieces.', 'مايونيز السيراتشا. يأتي 3 قطع.', '840', '69 SAR', '/chicken-sliders.jpg', 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','e','m','s','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='extraSlider'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Kale & Cabbage', 'كيل وملفوف', 'Parmigiano, pine nuts, honey za''atar dressing.', 'بارميزان، صنوبر، صلصة الزعتر والعسل.', '371', '59 SAR', '/kale-cabbage.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','m','n','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 2);

  -- ═══════════════════════════════════════════════════════════
  -- BRUNCH
  -- ═══════════════════════════════════════════════════════════

  -- Nibbles
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_brunch, 'Nibbles', 'المقبلات', 1) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Olives', 'زيتون', 'Simple, bright and savoury.', 'زيتون.', '115', '16 SAR', '/olives.jpg', true, 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Beetroot Hummus & Feta', 'حمص بالشمندر مع الفيتا', 'Beetroot hummus with feta.', 'حمص بالشمندر مع جبنة الفيتا.', '579', '29 SAR', '/beetroot-hummus.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='sourdough'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Halloumi Fries', 'أصابع الحلومي', 'Honey sriracha.', 'مع عسل السيراتشا.', '721', '39 SAR', '/halloumi-fries.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  -- Eggs
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_brunch, 'Eggs', 'البيض', 2) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, '2 Eggs Any Style', '٢ بيض من أي نوع', 'Fried, scrambled or poached.', 'مقلي، مخفوق أو مسلوق.', '461.4', '31 SAR', '/2-eggs.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e','g');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='beefBacon'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='avocado'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='mushrooms'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='montereyJack'), 4);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Scrambled Eggs', 'بيض مخفوق', 'Monterrey Jack, jalapeño mayo, brioche bun.', 'جبن مونتيري جاك، مايونيز هالبينو، خبز بريوش.', '869.25', '49 SAR', '/scrambled-eggs.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Turkish Eggs', 'بيض تركي', 'Cajun butter, pita.', 'زبدة الكاجون، خبز.', '697.5', '49 SAR', '/turkish-eggs.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='sourdough'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Eggs Florentine', 'بيض فلورنتين', 'Greens, Hollandaise, muffin.', 'خضار، صلصة هولنديز، مافن.', '858', '59 SAR', '/eggs-florentine.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Poached Eggs & Avocado Toast', 'بيض مسلوق مع توست الأفوكادو', 'Feta, coriander pesto.', 'جبنة فيتا، بيستو بالكزبرة.', '638', '65 SAR', '/poached-eggs-avocado.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  -- Salads
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_brunch, 'Salads', 'سلطات', 3) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Quinoa', 'كينوا', 'Pomegranate, baby tomato, lemon confit dressing.', 'رمان، طماطم صغيرة، صلصة كونفيت الليمون.', '269', '59 SAR', '/quinoa.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Kale & Cabbage', 'كيل وملفوف', 'Parmigiano, pine nuts, honey za''atar dressing.', 'بارميزان، صنوبر، مزين بالزعتر والعسل.', '371', '59 SAR', '/kale-cabbage.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('n','d','m','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 2);

  -- Add Ons
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_brunch, 'Add Ons', 'الإضافات', 4) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Spicy Fried Egg', 'بيض مقلي بالصلصة الحارة', 'Available as an add-on.', 'متوفر كإضافة.', '127', '12 SAR', '/spicy-fried-egg.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Halloumi', 'حلومي', 'Available as an add-on.', 'متوفر كإضافة.', '300', '19 SAR', '/halloumi.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Sumac Chicken', 'دجاج بالسماق', 'Available as an add-on.', 'متوفر كإضافة.', '160', '25 SAR', '/sumac-chicken.jpg', 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Smoked Paprika Prawn', 'جمبري بالبابريكا المدخنة', 'Available as an add-on.', 'متوفر كإضافة.', '133', '37 SAR', '/smoked-paprika-prawn.jpg', 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('sh');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Beef Bacon', 'لحم بقري مقدد', 'Available as an add-on.', 'متوفر كإضافة.', '400', '19 SAR', '/beef-bacon.jpg', 5);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Avocado', 'أفوكادو', 'Available as an add-on.', 'متوفر كإضافة.', '90', '15 SAR', '/avocado.jpg', true, 6);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Mushrooms', 'فطر', 'Available as an add-on.', 'متوفر كإضافة.', '358', '20 SAR', '/mushrooms.jpg', true, 7);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Grilled Halloumi', 'حلومي مشوي', 'Available as an add-on.', 'متوفر كإضافة.', '300', '19 SAR', '/halloumi.jpg', true, 8) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  -- Plates
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_brunch, 'Plates', 'الأطباق الرئيسية', 5) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Mushroom Toast', 'توست الفطر', 'Hazelnut salt.', 'مع البندق المملح.', '312', '59 SAR', '/mushroom-toast.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Chicken Sliders', 'سلايدر برجر دجاج', 'Sriracha mayo. Comes as 3 pieces.', 'مايونيز السيراتشا. يأتي 3 قطع.', '840', '69 SAR', '/chicken-sliders.jpg', 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','e','m','s','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='extraSlider'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Popcorn Chicken', 'بوب كورن الدجاج', 'Spicy mayo.', 'مع المايونيز الحار.', '425', '49 SAR', '/popcorn-chicken.jpg', 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('s','e','m','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Truffle Burger', 'برجر الكمأة', 'Monterrey Jack, truffle mayo.', 'مونتيري جاك، مايونيز الكمأة.', '1110', '79 SAR', '/truffle-burger.jpg', 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e','m');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='frites'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='truffleSauce'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='montereyJack'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='extraPatty'), 4);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Rigatoni Pink Sauce', 'ريجاتوني بالصلصة الوردية', 'Basil, chili, parmigiano.', 'ريحان، فلفل حار، بارميزان.', '560', '72 SAR', '/rigatoni-pink-sauce.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='chicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='prawns'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='parmesan'), 3);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Cajun Chicken', 'دجاج كاجون المشوي', 'Free range grilled cajun chicken, corn, tomatoes.', 'دجاج كاجون مشوي، ذرة، طماطم.', '767', '75 SAR', '/cajun-chicken.jpg', 6) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','m');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Corn & White Truffle Risotto', 'ريزوتو مع الكمأة والذرة', 'Creamy risotto with white truffle.', 'ريزوتو كريمي مع الكمأة البيضاء والذرة.', '510', '99 SAR', '/truffle-risotto.jpg', true, 7) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChickenRisotto'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='prawnsRisotto'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Black Angus Steak Au Poivre', 'بلاك أنجوس ستيك بالفلفل الأسود', 'Creamy pepper sauce.', 'صلصة الفلفل الكريمية.', '897', '120 SAR', '/black-angus-steak.jpg', 8) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='asparagus'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='houseSalad'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='frites'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='avocado'), 4);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Spaghetti Carbonara', 'معكرونة كاربونارا', 'Beef bacon, parmesan.', 'بيكون لحم بقري، بارميزان.', '932', '69 SAR', '/carbonara.jpg', 9) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  -- Sweets
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_brunch, 'Sweets', 'حلى', 6) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Greek Yogurt', 'زبادي يوناني', 'House granola, raspberry, caramel toast.', 'جرانولا، توت، توست بالكراميل.', '817', '52 SAR', '/greek-yogurt.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Crushed Milk Chocolate Cookies', 'كوكيز شوكولاتة الحليب المطحون', 'Frosties soft serve.', 'فروستيز ناعم.', '1067', '62 SAR', '/cookies.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Speculoos French Toast', 'سبشلوس فرنش توست', 'Raspberries, clotted cream. Allow 10 minutes.', 'مع التوت والكريمة الثقيلة. يحتاج 10 دقائق.', '462', '55 SAR', '/frenchtoast.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='darkChocolate'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='maple'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Ricotta Pancakes', 'فطائر ريكوتا', 'Dulce de leche, banana.', 'دولسي دي ليتشي مع الموز.', '840', '59 SAR', '/pancakes.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='darkChocolate'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='maple'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='dulce'), 3);

  -- Sides
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_brunch, 'Sides', 'الأطباق الجانبية', 7) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Avocado With Smoked Sea Salt', 'أفوكادو مع ملح البحر المدخن', 'Side order.', 'طبق جانبي.', '90', '15 SAR', '/avocado.jpg', true, 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'House Salad With Hazelnut Salt', 'سلطة المنزل مع ملح البندق', 'Side order.', 'طبق جانبي.', '249', '29 SAR', '/house-salad.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('s','n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Truffled Mac & Cheese', 'ترفل ماك أند تشيز', 'Side order.', 'طبق جانبي.', '1113', '79 SAR', '/truffled-mac-cheese.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Frites', 'بطاطس مقلية', 'Side order.', 'طبق جانبي.', '312', '25 SAR', '/frites.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='truffleSauce'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Asparagus & Toasted Hazelnuts', 'الهليون والبندق المحمص', 'Side order.', 'طبق جانبي.', '131', '39 SAR', '/asparagus.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('n');

  -- ═══════════════════════════════════════════════════════════
  -- DAYTIME
  -- ═══════════════════════════════════════════════════════════

  -- Nibbles
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_daytime, 'Nibbles', 'المقبلات', 1) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Olives', 'زيتون', 'Simple, bright and savoury.', 'زيتون.', '115', '16 SAR', '/olives.jpg', true, 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Beetroot Hummus & Feta', 'حمص بالشمندر مع الفيتا', 'Beetroot hummus with feta.', 'حمص بالشمندر مع جبنة الفيتا.', '579', '29 SAR', '/beetroot-hummus.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='sourdough'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Halloumi Fries', 'أصابع الحلومي', 'Honey sriracha.', 'مع عسل السيراتشا.', '721', '39 SAR', '/halloumi-fries.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  -- Small Plates To Share
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_daytime, 'Small Plates To Share', 'أطباق مشاركة صغيرة', 2) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Crushed Burrata', 'بوراتا مسحوقة', 'Cherry tomato, smoked salt.', 'طماطم كرزية مع ملح مدخن.', '465', '79 SAR', '/crushed-burrata.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Mushroom Toast', 'توست الفطر', 'Hazelnut salt.', 'مع البندق المملح.', '312', '59 SAR', '/mushroom-toast.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Chicken Sliders', 'سلايدر برجر دجاج', 'Sriracha mayo. Comes as 3 pieces.', 'مايونيز السيراتشا. يأتي 3 قطع.', '840', '69 SAR', '/chicken-sliders.jpg', 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','e','m','s','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='extraSlider'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Honey Sweet Potato', 'بطاطا حلوة بالعسل', 'Black pepper yogurt, zhoug.', 'زبادي بالفلفل الأسود، زحوق.', '280', '42 SAR', '/honey-sweet-potato.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Flamed Aubergine', 'فليمد باذنجان', 'Miso, crispy rice, greek yogurt.', 'ميسو، أرز مقرمش، الزبادي اليوناني.', '535', '45 SAR', '/flamed-aubergine.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','s','d','su','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Popcorn Chicken', 'بوب كورن الدجاج', 'Spicy mayo.', 'مع المايونيز الحار.', '425', '49 SAR', '/popcorn-chicken.jpg', 6) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('s','e','m','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Avocado Toast', 'توست الأفوكادو', 'Feta, coriander pesto.', 'جبنة الفيتا، بيستو الكزبرة.', '442', '59 SAR', '/avocado-toast.jpg', true, 7) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','n');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 1);

  -- Salads
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_daytime, 'Salads', 'سلطات', 3) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Quinoa', 'كينوا', 'Pomegranate, baby tomato, lemon confit dressing.', 'رمان، طماطم صغيرة، صلصة كونفيت الليمون.', '269', '59 SAR', '/quinoa.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Kale & Cabbage', 'كيل وملفوف', 'Parmigiano, pine nuts, golden raisins, honey za''atar dressing.', 'بارميزان، صنوبر، زبيب، صلصة الزعتر والعسل.', '371', '59 SAR', '/kale-cabbage.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','m','n','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Radicchio Salad', 'سلطة راديكيو', 'Radicchio, iceberg, walnut, lemon chili dressing.', 'راديكيو وخس آيسبرغ، جوز، صلصة ليمون حار.', '373', '39 SAR', '/radicchio.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('n');

  -- Add Ons
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_daytime, 'Add Ons', 'الإضافات', 4) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Spicy Fried Egg', 'بيض مقلي بالصلصة الحارة', 'Available as an add-on.', 'متوفر كإضافة.', '127', '12 SAR', '/spicy-fried-egg.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Halloumi', 'حلومي', 'Available as an add-on.', 'متوفر كإضافة.', '300', '19 SAR', '/halloumi.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Sumac Chicken', 'دجاج بالسماق', 'Available as an add-on.', 'متوفر كإضافة.', '160', '25 SAR', '/sumac-chicken.jpg', 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Smoked Paprika Prawn', 'جمبري بالبابريكا المدخنة', 'Available as an add-on.', 'متوفر كإضافة.', '133', '37 SAR', '/smoked-paprika-prawn.jpg', 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('sh');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Beef Bacon', 'لحم بقري مقدد', 'Available as an add-on.', 'متوفر كإضافة.', '400', '19 SAR', '/beef-bacon.jpg', 5);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Avocado', 'أفوكادو', 'Available as an add-on.', 'متوفر كإضافة.', '90', '15 SAR', '/avocado.jpg', true, 6);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Mushrooms', 'فطر', 'Available as an add-on.', 'متوفر كإضافة.', '358', '20 SAR', '/mushrooms.jpg', true, 7);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Grilled Halloumi', 'حلومي مشوي', 'Available as an add-on.', 'متوفر كإضافة.', '300', '19 SAR', '/halloumi.jpg', true, 8) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  -- Mains
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_daytime, 'Mains', 'الأطباق الرئيسية', 5) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Rigatoni Pink Sauce', 'ريجاتوني بالصلصة الوردية', 'Basil, chili, parmigiano.', 'ريحان، فلفل حار، بارميزان.', '560', '72 SAR', '/rigatoni-pink-sauce.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='chicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='prawns'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='parmesan'), 3);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Cajun Chicken', 'دجاج كاجون المشوي', 'Free range grilled cajun chicken, corn, tomatoes.', 'دجاج كاجون مشوي، ذرة، طماطم.', '767', '75 SAR', '/cajun-chicken.jpg', 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','m');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Truffle Burger', 'برجر الكمأة', 'Monterrey Jack, truffle mayo.', 'مونتيري جاك، مايونيز الكمأة.', '1110', '79 SAR', '/truffle-burger.jpg', 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e','m');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='frites'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='truffleSauce'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='montereyJack'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='extraPatty'), 4);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Corn & White Truffle Risotto', 'ريزوتو مع الكمأة والذرة', 'Creamy risotto with white truffle.', 'ريزوتو كريمي مع الكمأة البيضاء والذرة.', '510', '99 SAR', '/truffle-risotto.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChickenRisotto'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='prawnsRisotto'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Black Angus Steak Au Poivre', 'بلاك أنجوس ستيك بالفلفل الأسود', 'Pepper sauce.', 'صلصة الفلفل.', '897', '120 SAR', '/black-angus-steak.jpg', 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='asparagus'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='houseSalad'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='frites'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='avocado'), 4);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Spaghetti Carbonara', 'معكرونة كاربونارا', 'Beef bacon, parmesan.', 'بيكون لحم بقري، بارميزان.', '932', '69 SAR', '/carbonara.jpg', 6) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  -- Sides
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_daytime, 'Sides', 'الأطباق الجانبية', 6) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Avocado With Smoked Sea Salt', 'أفوكادو مع ملح البحر المدخن', 'Side order.', 'طبق جانبي.', '90', '15 SAR', '/avocado.jpg', true, 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Frites', 'بطاطس مقلية', 'Side order.', 'طبق جانبي.', '312', '25 SAR', '/frites.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='truffleSauce'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'House Salad With Hazelnut Salt', 'سلطة المنزل مع ملح البندق', 'Side order.', 'طبق جانبي.', '249', '29 SAR', '/house-salad.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('s','n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Truffled Mac & Cheese', 'ترفل ماك أند تشيز', 'Side order.', 'طبق جانبي.', '1113', '79 SAR', '/truffled-mac-cheese.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Asparagus & Toasted Hazelnuts', 'الهليون والبندق المحمص', 'Side order.', 'طبق جانبي.', '131', '39 SAR', '/asparagus.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('n');

  -- ═══════════════════════════════════════════════════════════
  -- EVENING
  -- ═══════════════════════════════════════════════════════════

  -- Nibbles
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_evening, 'Nibbles', 'المقبلات', 1) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Olives', 'زيتون', 'Simple, bright and savoury.', 'زيتون.', '115', '16 SAR', '/olives.jpg', true, 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Beetroot Hummus & Feta', 'حمص بالشمندر مع الفيتا', 'Beetroot hummus with feta.', 'حمص بالشمندر مع جبنة الفيتا.', '579', '29 SAR', '/beetroot-hummus.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='sourdough'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Halloumi Fries', 'أصابع الحلومي', 'Honey sriracha.', 'مع عسل السيراتشا.', '721', '39 SAR', '/halloumi-fries.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  -- Salads
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_evening, 'Salads', 'سلطات', 2) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Kale & Cabbage', 'كيل وملفوف', 'Parmigiano, pine nuts, golden raisins, honey za''atar dressing.', 'بارميزان، صنوبر، زبيب، صلصة الزعتر والعسل.', '371', '45 SAR', '/kale-cabbage.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','m','n','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Quinoa', 'كينوا', 'Pomegranate, baby tomato, lemon confit dressing.', 'رمان، طماطم صغيرة، صلصة كونفيت الليمون.', '269', '45 SAR', '/quinoa.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='grilledHalloumi'), 2);

  -- Small Plates To Share
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_evening, 'Small Plates To Share', 'أطباق مشاركة صغيرة', 3) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Chicken Sliders', 'سلايدر برجر دجاج', 'Sriracha mayo. Comes as 3 pieces.', 'مايونيز السيراتشا. يأتي 3 قطع.', '840', '69 SAR', '/chicken-sliders.jpg', 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','e','m','s','se');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='extraSlider'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Honey Sweet Potato', 'بطاطا حلوة بالعسل', 'Black pepper yogurt, zhoug.', 'زبادي بالفلفل الأسود، زحوق.', '280', '42 SAR', '/honey-sweet-potato.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Flamed Aubergine', 'فليمد باذنجان', 'Miso, crispy rice, greek yogurt.', 'ميسو، أرز مقرمش، الزبادي اليوناني.', '535', '45 SAR', '/flamed-aubergine.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','s','d','su','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Popcorn Chicken', 'بوب كورن الدجاج', 'Spicy mayo.', 'مع المايونيز الحار.', '425', '49 SAR', '/popcorn-chicken.jpg', 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('s','e','m','se');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Crushed Burrata', 'بوراتا مسحوقة', 'Cherry tomatoes, smoked salt.', 'طماطم كرزية مع ملح مدخن.', '465', '79 SAR', '/crushed-burrata.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='pita'), 1);

  -- Mains
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_evening, 'Mains', 'الأطباق الرئيسية', 4) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Rigatoni Pink Sauce', 'ريجاتوني بالصلصة الوردية', 'Basil, chili, parmigiano.', 'ريحان، فلفل حار، بارميزان.', '560', '72 SAR', '/rigatoni-pink-sauce.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='chicken'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='prawns'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='parmesan'), 3);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Cajun Chicken', 'دجاج كاجون المشوي', 'Free range grilled cajun chicken, corn, tomatoes.', 'دجاج كاجون مشوي، ذرة، طماطم.', '767', '75 SAR', '/cajun-chicken.jpg', 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d','m');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Truffle Burger', 'برجر الكمأة', 'Monterrey Jack, truffle mayo.', 'مونتيري جاك، مايونيز الكمأة.', '1110', '79 SAR', '/truffle-burger.jpg', 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e','m');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='frites'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='truffleSauce'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='montereyJack'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='extraPatty'), 4);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Corn & White Truffle Risotto', 'ريزوتو مع الكمأة والذرة', 'Creamy risotto with white truffle.', 'ريزوتو كريمي مع الكمأة البيضاء والذرة.', '510', '99 SAR', '/truffle-risotto.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='sumacChickenRisotto'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='prawnsRisotto'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Spaghetti Carbonara', 'معكرونة كاربونارا', 'Beef bacon, parmesan.', 'بيكون لحم بقري، بارميزان.', '932', '69 SAR', '/carbonara.jpg', 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Black Angus Steak Au Poivre', 'بلاك أنجوس ستيك بالفلفل الأسود', 'Creamy pepper sauce.', 'صلصة الفلفل الكريمية.', '897', '120 SAR', '/black-angus-steak.jpg', 6) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('d');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='asparagus'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='houseSalad'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='frites'), 3), (item_id, (SELECT id FROM add_ons WHERE slug='avocado'), 4);

  -- Sides
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_evening, 'Sides', 'الأطباق الجانبية', 5) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Truffled Mac & Cheese', 'ترفل ماك أند تشيز', 'Side order.', 'طبق جانبي.', '1113', '79 SAR', '/truffled-mac-cheese.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Asparagus & Toasted Hazelnuts', 'الهليون والبندق المحمص', 'Side order.', 'طبق جانبي.', '131', '39 SAR', '/asparagus.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'Frites', 'بطاطس مقلية', 'Side order.', 'طبق جانبي.', '312', '25 SAR', '/frites.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='truffleSauce'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegan, sort_order) VALUES
    (sec_id, 'House Salad With Hazelnut Salt', 'سلطة المنزل مع ملح البندق', 'Side order.', 'طبق جانبي.', '249', '29 SAR', '/house-salad.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('s','n');

  -- ═══════════════════════════════════════════════════════════
  -- DESSERTS
  -- ═══════════════════════════════════════════════════════════

  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_desserts, 'Desserts', 'حلى', 1) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Affogato', 'أفوقاتو', 'Espresso poured over soft serve.', 'إسبريسو فوق سوفت سيرف.', '400', '39 SAR', '/affogato.jpg', true, 1) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Churros, Burnt Milk', 'شوروز مع الحليب المحروق', 'Crispy churros with burnt milk dip.', 'شوروز مقرمش مع صوص الحليب المحروق.', '650', '45 SAR', '/churros.jpg', true, 2) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='darkChocolate'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Speculoos French Toast', 'سبشلوس فرنش توست', 'Raspberries, clotted cream. Allow 10 minutes.', 'مع التوت والكريمة الثقيلة. يحتاج 10 دقائق.', '462', '55 SAR', '/frenchtoast.jpg', true, 3) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='darkChocolate'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='maple'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Strawberry Pistachio Pavlova', 'بافلوفا بالفراولة والفستق', 'Light meringue with strawberries and pistachio.', 'ميرنغ خفيف مع الفراولة والفستق.', '652', '55 SAR', '/pavlova.jpg', true, 4) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('e','d','n');

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Ricotta Pancakes', 'فطائر ريكوتا', 'Dulce de leche, banana.', 'دولسي دي ليتشي مع الموز.', '840', '59 SAR', '/pancakes.jpg', true, 5) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='darkChocolate'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='maple'), 2), (item_id, (SELECT id FROM add_ons WHERE slug='dulce'), 3);

  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, vegetarian, sort_order) VALUES
    (sec_id, 'Crushed Milk Chocolate Cookies', 'كوكيز شوكولاتة الحليب المطحون', 'Frosties soft serve.', 'فروستيز ناعم.', '1067', '62 SAR', '/cookies.jpg', true, 6) RETURNING id INTO item_id;
  INSERT INTO item_allergens (item_id, allergen_id) SELECT item_id, id FROM allergens WHERE code IN ('g','d','e');

  -- ═══════════════════════════════════════════════════════════
  -- DRINKS
  -- ═══════════════════════════════════════════════════════════

  -- Non Alcoholic Cocktails
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_drinks, 'Non Alcoholic Cocktails', 'كوكتيلات بدون كحول', 1) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Apple & Lemon, Lime, Mint', 'تفاح وليمون ولايم ونعناع', '-', '29 SAR', '/menu-icons/apple-lemon-lime-mint.jpg', 1);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Blackberry & Vanilla, Lemon', 'بلاك بيري وفانيلا وليمون', '-', '29 SAR', '/menu-icons/blackberry-vanilla-lemon.jpg', 2);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Pineapple & Rosemary, Mint', 'أناناس وإكليل الجبل ونعناع', '-', '29 SAR', '/menu-icons/pineapple-rosemary-mint.jpg', 3);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Mango & Cardamom, Basil', 'مانجو وهيل وريحان', '-', '29 SAR', '/menu-icons/mango-cardamom-basil.jpg', 4);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Kumquat, Rosemary & Lemon', 'كومكوات وإكليل الجبل وليمون', '-', '29 SAR', '/menu-icons/lemon-kumquat-rosemary.jpg', 5);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Passion Fruit Mojito', 'موهيتو باشن فروت', '-', '29 SAR', '/menu-icons/passion-fruit-mojito.jpg', 6);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Strawberry Mojito', 'موهيتو فراولة', '-', '29 SAR', '/menu-icons/strawberry-mojito.jpg', 7);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Raspberry Mojito', 'موهيتو توت', '-', '29 SAR', '/menu-icons/raspberry-mojito.jpg', 8);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Classic Mojito', 'موهيتو كلاسيك', '-', '29 SAR', '/menu-icons/classic-mojito.jpg', 9);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Watermelon & Mint, Lemon', 'بطيخ ونعناع وليمون', '-', '29 SAR', '/menu-icons/watermelon-mint-lemon.jpg', 10);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Passion Fruit Lemonade', 'ليمونادة باشن فروت', '-', '29 SAR', '/menu-icons/passion-fruit-lemonade.jpg', 11);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Raspberry & Cranberry Lemonade', 'ليمونادة توت وكرانبيري', '-', '29 SAR', '/menu-icons/raspberry-cranberry-lemonade.jpg', 12);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Homemade Basil Lemonade', 'ليمونادة ريحان منزلية', '-', '29 SAR', '/menu-icons/basil-lemonade.jpg', 13);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Still Homemade Lemonade', 'ليمونادة منزلية عادية', '-', '29 SAR', '/menu-icons/still-homemade-lemonade.jpg', 14);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Sparkling Homemade Lemonade', 'ليمونادة منزلية فوارة', '-', '29 SAR', '/menu-icons/sparkling-homemade-lemonade.jpg', 15);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Orange & Pineapple, Almond', 'برتقال وأناناس ولوز', '-', '29 SAR', '/menu-icons/orange-pineapple-almond.jpg', 16);

  -- Coffee
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_drinks, 'Coffee', 'قهوة', 2) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Espresso', 'إسبريسو', '-', '18 SAR', '/menu-icons/espresso.jpg', 1);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Macchiato', 'ماكياتو', '-', '18 SAR', '/macchiato.jpg', 2);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Double Macchiato', 'ماكياتو دبل', '-', '18 SAR', '/double-macchiato.jpg', 3);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Cortado', 'كورتادو', '-', '22 SAR', '/menu-icons/cortado.jpg', 4) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='milkUpgrade'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Americano', 'أمريكانو', '-', '22 SAR', '/menu-icons/americano.jpg', 5) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 1);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Latte', 'لاتيه', '-', '24 SAR', '/menu-icons/latte.jpg', 6) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='milkUpgrade'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Cappuccino', 'كابتشينو', '-', '24 SAR', '/menu-icons/cappuccino.jpg', 7) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='milkUpgrade'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Flat White', 'فلات وايت', '-', '24 SAR', '/menu-icons/flat-white.jpg', 8) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='milkUpgrade'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Spanish Latte', 'سبانيش لاتيه', '-', '29 SAR', '/menu-icons/spanish-latte.jpg', 9) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='milkUpgrade'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Mocha', 'موكا', '-', '24 SAR', '/menu-icons/mocha.jpg', 10) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='milkUpgrade'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 2);

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Hot Chocolate', 'شوكولاتة ساخنة', '-', '25 SAR', '/menu-icons/hot-chocolate.jpg', 11) RETURNING id INTO item_id;
  INSERT INTO item_addons (item_id, addon_id, sort_order) VALUES (item_id, (SELECT id FROM add_ons WHERE slug='milkUpgrade'), 1), (item_id, (SELECT id FROM add_ons WHERE slug='vanillaSyrup'), 2);

  -- Iced Coffee
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_drinks, 'Iced Coffee', 'قهوة باردة', 3) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Iced Americano', 'أمريكانو بارد', '-', '22 SAR', '/menu-icons/iced-americano.jpg', 1);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Iced Latte', 'لاتيه بارد', '-', '24 SAR', '/menu-icons/iced-latte.jpg', 2);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Iced Mocha', 'موكا بارد', '-', '24 SAR', '/menu-icons/iced-mocha.jpg', 3);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Coconut Iced Latte', 'لاتيه جوز الهند البارد', '-', '29 SAR', '/menu-icons/coconut-iced-latte.jpg', 4);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Iced Spanish Latte', 'سبانيش لاتيه بارد', '-', '29 SAR', '/menu-icons/iced-spanish-latte.jpg', 5);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Toasted Banana Iced Latte', 'لاتيه بارد بالموز المحمص', '-', '29 SAR', '/menu-icons/toasted-banana-iced-latte.jpg', 6);

  -- Tea
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_drinks, 'Tea', 'شاي', 4) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Jasmine Iced Tea', 'شاي ياسمين بارد', '-', '25 SAR', '/menu-icons/jasmine-iced-tea.jpg', 1);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Jasmine Tea', 'شاي ياسمين', '-', '39 SAR', '/menu-icons/jasmine-tea.jpg', 2);
  INSERT INTO menu_items (section_id, name_en, name_ar, desc_en, desc_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Tea Selection', 'تشكيلة شاي', 'English Breakfast, Fresh Mint, Peppermint, Chamomile, Green Tea', 'إنجليزي، نعناع طازج، نعناع، بابونج، شاي أخضر', '-', '22 SAR', '/menu-icons/breakfast-tea.jpg', 3);

  -- Soft Drinks
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_drinks, 'Soft Drinks', 'مشروبات غازية', 5) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Coca Cola', 'كوكاكولا', '-', '16 SAR', '/menu-icons/coca-cola.jpg', 1);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Coca Cola Light', 'كوكاكولا لايت', '-', '16 SAR', '/menu-icons/coca-cola-light.jpg', 2);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, '7 Up', 'سفن أب', '-', '16 SAR', '/menu-icons/seven-up.jpg', 3);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Apple Juice', 'عصير تفاح', '-', '16 SAR', '/menu-icons/juice-apple.jpg', 4);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Pineapple Juice', 'عصير أناناس', '-', '16 SAR', '/menu-icons/juice-pineapple.jpg', 5);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Cranberry Juice', 'عصير كرانبيري', '-', '16 SAR', '/menu-icons/juice-cranberry.jpg', 6);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Small Sparkling Water', 'مياه غازية صغيرة', '-', '17 SAR', '/menu-icons/small-sparkling-water.jpg', 7);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Large Sparkling Water', 'مياه غازية كبيرة', '-', '24 SAR', '/menu-icons/large-sparkling-water.jpg', 8);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Still Water', 'مياه عادية', '-', '24 SAR', '/menu-icons/still-water.jpg', 9);

  -- Fresh Juices
  INSERT INTO sections (category_id, name_en, name_ar, sort_order) VALUES (cat_drinks, 'Fresh Juices', 'عصائر طازجة', 6) RETURNING id INTO sec_id;

  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Orange', 'برتقال', '-', '22 SAR', '/menu-icons/fresh-orange-juice.jpg', 1);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Apple, Beetroot & Celery', 'تفاح و شمندر و كرفس', '-', '25 SAR', '/menu-icons/apple-beetroot-celery.jpg', 2);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Apple, Cucumber & Spinach', 'تفاح و خيار و سبانخ', '-', '25 SAR', '/menu-icons/apple-cucumber-spinach.jpg', 3);
  INSERT INTO menu_items (section_id, name_en, name_ar, calories, price, image, sort_order) VALUES
    (sec_id, 'Carrot, Apple & Ginger', 'جزر و تفاح و زنجبيل', '-', '25 SAR', '/menu-icons/carrot-apple-ginger.jpg', 4);

END $$;
