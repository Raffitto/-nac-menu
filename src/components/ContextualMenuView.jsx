import React, { useMemo, useCallback } from "react";
import { motion } from "framer-motion";
import FoodMenuCard from "./FoodMenuCard";
import DrinkMenuCard from "./DrinkMenuCard";
import { makeSectionDomId, sectionSlug } from "../lib/sectionNav";

const SUBSECTION_CATEGORIES = new Set(["drinks", "desserts"]);

function mapSectionNavItems(block, isArabic) {
  return block.sections.map((sec) => ({
    catId: block.catId,
    titleEn: sec.title.en,
    titleAr: sec.title.ar,
    domId: makeSectionDomId(block.catId, sec.title.en),
    label: isArabic ? sec.title.ar : sec.title.en,
  }));
}

export default function ContextualMenuView({
  categoryIds,
  isManualMode,
  categories,
  menuData,
  activeCategory,
  setActiveCategory,
  isArabic,
  lang,
  search,
  isAllowed,
  onOpenItem,
  onBackToContextual,
  activeSection,
  onSectionNavigate,
}) {
  const categoryMeta = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const blocks = useMemo(() => {
    const term = search.toLowerCase().trim();
    return (categoryIds || [])
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
  }, [categoryIds, menuData, search, isAllowed, categoryMeta]);

  const activeBlock = useMemo(
    () => blocks.find((b) => b.catId === activeCategory),
    [blocks, activeCategory],
  );

  const foodSectionNavItems = useMemo(() => {
    if (!activeBlock || SUBSECTION_CATEGORIES.has(activeCategory)) return [];
    return mapSectionNavItems(activeBlock, isArabic);
  }, [activeBlock, activeCategory, isArabic]);

  const subsectionNavItems = useMemo(() => {
    if (!activeBlock || !SUBSECTION_CATEGORIES.has(activeCategory)) return [];
    if (activeBlock.sections.length <= 1) return [];
    return mapSectionNavItems(activeBlock, isArabic);
  }, [activeBlock, activeCategory, isArabic]);

  const scrollToCategory = useCallback(
    (catId) => {
      setActiveCategory(catId);
      const block = blocks.find((b) => b.catId === catId);
      const firstSection = block?.sections?.[0];
      if (SUBSECTION_CATEGORIES.has(catId) && firstSection) {
        const domId = makeSectionDomId(catId, firstSection.title.en);
        onSectionNavigate?.(catId, firstSection.title.en, domId);
        requestAnimationFrame(() => {
          document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
        return;
      }
      document.getElementById(`nac-cat-${catId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [setActiveCategory, blocks, onSectionNavigate],
  );

  const scrollToSection = useCallback(
    (item) => {
      setActiveCategory(item.catId);
      onSectionNavigate?.(item.catId, item.titleEn, item.domId);
      document.getElementById(item.domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [onSectionNavigate, setActiveCategory],
  );

  const renderSectionNav = (items, className, ariaLabel) => (
    <nav className={className} aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.domId}
          type="button"
          className={activeSection === item.domId ? "active active-section" : ""}
          onClick={() => scrollToSection(item)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="contextual-menu">
      <div className="contextual-nav-stack">
        <div className="contextual-menu-bar contextual-menu-bar-primary">
          {isManualMode ? (
            <button type="button" className="contextual-pill contextual-pill-back" onClick={onBackToContextual}>
              {isArabic ? "القائمة النشطة" : "Active Menu"}
            </button>
          ) : (
            categoryIds.map((catId) => {
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
        </div>

        {subsectionNavItems.length > 0 &&
          renderSectionNav(
            subsectionNavItems,
            "section-nav contextual-subsection-nav",
            isArabic ? "أقسام المشروبات" : "Drink sections",
          )}

        {foodSectionNavItems.length > 0 &&
          renderSectionNav(
            foodSectionNavItems,
            "section-nav contextual-section-nav-secondary",
            isArabic ? "أقسام القائمة" : "Menu sections",
          )}
      </div>

      {blocks.map((block) => (
        <div key={block.catId} id={`nac-cat-${block.catId}`} className="contextual-category-block">
          <div className="contextual-category-head">
            <h2>{isArabic ? block.meta?.ar : block.meta?.en}</h2>
            <span>{isArabic ? block.meta?.timeAr : block.meta?.timeEn}</span>
          </div>

          {block.sections.map((sec, sectionIndex) => {
            const sectionDomId = makeSectionDomId(block.catId, sec.title.en);
            return (
              <section
                key={`${block.catId}-${sec.title.en}`}
                id={sectionDomId}
                data-section-slug={sectionSlug(sec.title.en)}
                data-category-id={block.catId}
                className={
                  block.catId === "drinks"
                    ? "drink-section-block contextual-menu-section"
                    : "menu-section contextual-menu-section"
                }
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
            );
          })}
        </div>
      ))}

      {blocks.length === 0 && (
        <p className="empty-state">{isArabic ? "لا توجد نتائج مطابقة" : "No matching results"}</p>
      )}
    </div>
  );
}
