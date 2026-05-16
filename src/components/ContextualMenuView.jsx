import React, { useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import FoodMenuCard from "./FoodMenuCard";
import DrinkMenuCard from "./DrinkMenuCard";

export default function ContextualMenuView({
  flow,
  categories,
  menuData,
  activeCategory,
  setActiveCategory,
  isArabic,
  lang,
  search,
  isAllowed,
  onOpenItem,
  onShowAllMenus,
  exploreOnlyCategory,
  onBackToContextual,
}) {
  const categoryMeta = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const blocks = useMemo(() => {
    const displayCategoryIds = exploreOnlyCategory ? [exploreOnlyCategory] : flow.categories;
    const term = search.toLowerCase().trim();
    return displayCategoryIds
      .map((catId) => {
        const sections = (menuData[catId] || [])
          .map((sec) => ({
            ...sec,
            items: sec.items.filter((item) => {
              if (!isAllowed(item)) return false;
              if (!term) return true;
              const text = `${item.en} ${item.ar} ${item.descEn} ${item.descAr}`.toLowerCase();
              return text.includes(term);
            }),
          }))
          .filter((sec) => sec.items.length > 0);
        return { catId, meta: categoryMeta[catId], sections };
      })
      .filter((b) => b.sections.length > 0);
  }, [exploreOnlyCategory, flow.categories, menuData, search, isAllowed, categoryMeta]);

  const scrollToCategory = useCallback(
    (catId) => {
      setActiveCategory(catId);
      document.getElementById(`nac-cat-${catId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [setActiveCategory],
  );

  return (
    <div className="contextual-menu">
      <div className="contextual-menu-bar">
        {exploreOnlyCategory ? (
          <button type="button" className="contextual-pill contextual-pill-back" onClick={onBackToContextual}>
            {isArabic ? "القائمة النشطة" : "Active Menu"}
          </button>
        ) : (
          flow.categories.map((catId) => {
            const meta = categoryMeta[catId];
            if (!meta) return null;
            return (
              <button
                key={catId}
                type="button"
                className={`contextual-pill ${activeCategory === catId ? "active" : ""}`}
                onClick={() => scrollToCategory(catId)}
              >
                {isArabic ? meta.ar : meta.en}
              </button>
            );
          })
        )}
        <button type="button" className="contextual-pill contextual-pill-gold" onClick={onShowAllMenus}>
          {isArabic ? "كل القوائم" : "All Menus"}
        </button>
      </div>

      {blocks.map((block) => (
        <div key={block.catId} id={`nac-cat-${block.catId}`} className="contextual-category-block">
          <div className="contextual-category-head">
            <h2>{isArabic ? block.meta?.ar : block.meta?.en}</h2>
            <span>{isArabic ? block.meta?.timeAr : block.meta?.timeEn}</span>
          </div>

          {block.sections.map((sec, sectionIndex) => (
            <section
              key={`${block.catId}-${sec.title.en}`}
              className={block.catId === "drinks" ? "drink-section-block" : "menu-section"}
            >
              <h3 className="section-title no-arabic-spacing">{isArabic ? sec.title.ar : sec.title.en}</h3>

              {block.catId === "drinks" ? (
                <div className="drink-card-grid">
                  {sec.items.map((menuItem, index) => (
                    <DrinkMenuCard
                      key={`${menuItem.en}-${index}`}
                      menuItem={menuItem}
                      categoryId={block.catId}
                      sectionTitleEn={sec.title.en}
                      sectionIndex={sectionIndex}
                      itemIndex={index}
                      language={lang}
                      isArabic={isArabic}
                      enabled
                      onOpenItem={onOpenItem}
                    />
                  ))}
                </div>
              ) : (
                <motion.div
                  className="menu-grid menu-grid-compact"
                  initial="show"
                  animate="show"
                  variants={{ show: { transition: { staggerChildren: 0.03 } } }}
                >
                  {sec.items.map((menuItem, index) => (
                    <FoodMenuCard
                      key={`${menuItem.en}-${index}`}
                      menuItem={menuItem}
                      categoryId={block.catId}
                      sectionTitleEn={sec.title.en}
                      sectionIndex={sectionIndex}
                      itemIndex={index}
                      language={lang}
                      isArabic={isArabic}
                      enabled
                      onOpenItem={onOpenItem}
                      variants={{
                        hidden: { opacity: 0, y: 12 },
                        show: { opacity: 1, y: 0 },
                      }}
                    />
                  ))}
                </motion.div>
              )}
            </section>
          ))}
        </div>
      ))}

      {blocks.length === 0 && (
        <p className="empty-state">{isArabic ? "لا توجد نتائج مطابقة" : "No matching results"}</p>
      )}
    </div>
  );
}
