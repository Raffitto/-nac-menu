-- Fix English breakfast category card icon (was breakfast.svg in some DBs)
UPDATE public.categories
SET icon = '/menu-icons/breakfast.png',
    icon_ar = '/menu-icons-ar/Breakfast.png'
WHERE slug = 'breakfast';
