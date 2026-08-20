-- Food Bible card assets: recipe photograph path on the canonical recipe.
-- Images are stored in the existing public menu-images bucket (food-bible/ prefix).

alter table public.inventory_recipes
  add column if not exists hero_image_path text;

comment on column public.inventory_recipes.hero_image_path is
  'Storage path in menu-images for the source dish photograph. Not a PDF byte store.';
