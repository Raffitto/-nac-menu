-- Update brunch / daytime category schedule copy (Fri–Sat brunch, Sun–Thu daytime lunch).
-- Run in Supabase SQL Editor on live projects after menu_seed.sql.

UPDATE public.categories
SET
  time_en = 'Fri–Sat · 12–5 PM',
  time_ar = 'الجمعة–السبت · ١٢–٥ م'
WHERE slug = 'brunch';

UPDATE public.categories
SET
  time_en = 'Sun–Thu · 12–5 PM',
  time_ar = 'الأحد–الخميس · ١٢–٥ م'
WHERE slug = 'daytime';
