-- Fix English breakfast category card icon (use English artwork JPEG)
UPDATE categories
SET icon = '/menu-icons/breakfast.jpeg',
    icon_ar = '/menu-icons-ar/Breakfast.png'
WHERE slug = 'breakfast';
