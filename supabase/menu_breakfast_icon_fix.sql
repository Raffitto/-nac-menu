-- Fix English breakfast category card icon (use English artwork PNG)
UPDATE categories
SET icon = '/menu-icons/breakfast-en.png',
    icon_ar = '/menu-icons-ar/Breakfast.png'
WHERE slug = 'breakfast';
