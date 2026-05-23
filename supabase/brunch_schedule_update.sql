-- Update brunch / daytime category schedule copy (Wed–Sat brunch, Sun–Tue daytime lunch).
-- Run in Supabase SQL Editor on live projects after menu_seed.sql.

UPDATE public.categories
SET
  time_en = 'Wed–Sat · 12–5 PM',
  time_ar = 'الأربعاء–السبت · ١٢–٥ م'
WHERE slug = 'brunch';

UPDATE public.categories
SET
  time_en = 'Sun–Tue · 12–5 PM',
  time_ar = 'الأحد–الثلاثاء · ١٢–٥ م'
WHERE slug = 'daytime';
