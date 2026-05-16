export function sectionSlug(titleEn) {
  return titleEn.toLowerCase().replaceAll(" ", "-");
}

export function makeSectionDomId(categoryId, titleEn) {
  return `nac-sec-${categoryId}-${sectionSlug(titleEn)}`;
}
