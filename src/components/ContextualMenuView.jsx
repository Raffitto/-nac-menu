import React, { useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import FoodMenuCard from "./FoodMenuCard";
import DrinkMenuCard from "./DrinkMenuCard";
import { makeSectionDomId, sectionSlug } from "../lib/sectionNav";
import {
  getMenuLevelTabs,
  getMenuTabSections,
  hasMenuLevelTabs,
  isDrinksCatalog,
} from "../lib/menuPresentation";

function mapSectionNavItems(sourceCategoryId, sections, isArabic) {
  return sections.map((sec) => ({
    sourceCategoryId,
    titleEn: sec.title.en,
    titleAr: sec.title.ar,
    domId: makeSectionDomId(sourceCategoryId, sec.title.en),
    label: isArabic ? sec.title.ar : sec.title.en,
  }));
}

function filterSections(sections, search, isAllowed) {
  const term = search.toLowerCase().trim();
  return sections
    .map((sec) => ({
      ...sec,
      items: (sec.items || []).filter((item) => {
        if (!isAllowed(item)) return false;
        if (!term) return true;
        const text = `${item.en} ${item.ar} ${item.descEn} ${item.descAr}`.toLowerCase();
        return text.includes(term);
      }),
    }))
    .filter((sec) => sec.items.length > 0);
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
  activeMenuTab,
  setActiveMenuTab,
  setActiveSection,
  onMenuTabOpen,
}) {
  const categoryMeta = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  );

  const hostCategoryId = categoryIds?.[0] || activeCategory;
  const menuTabs = useMemo(
    () => (hasMenuLevelTabs(hostCategoryId) ? getMenuLevelTabs(hostCategoryId, isArabic) : []),
    [hostCategoryId, isArabic],
  );

  const activeTab = useMemo(
    () => menuTabs.find((t) => t.id === activeMenuTab) || menuTabs[0] || null,
    [menuTabs, activeMenuTab],
  );

  const sourceCategoryId = activeTab?.sourceCategoryId || hostCategoryId;

  const visibleSections = useMemo(() => {
    const raw = getMenuTabSections(sourceCategoryId, menuData);
    return filterSections(raw, search, isAllowed);
  }, [sourceCategoryId, menuData, search, isAllowed]);

  const sectionNavItems = useMemo(() => {
    if (!visibleSections.length) return [];
    return mapSectionNavItems(sourceCategoryId, visibleSections, isArabic);
  }, [visibleSections, sourceCategoryId, isArabic]);

  const scrollToMenuTab = useCallback(
    (tab) => {
      setActiveMenuTab(tab.id);
      setActiveSection("");
      onMenuTabOpen?.(tab);
      const sections = filterSections(
        getMenuTabSections(tab.sourceCategoryId, menuData),
        "",
        isAllowed,
      );
      const first = sections[0];
      if (first) {
        const domId = makeSectionDomId(tab.sourceCategoryId, first.title.en);
        onSectionNavigate?.(tab.sourceCategoryId, first.title.en, domId, {
          source: "nav_click",
          hostCategoryId,
          menuTabId: tab.id,
        });
        requestAnimationFrame(() => {
          document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      } else {
        document.getElementById(`nac-menu-${hostCategoryId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [setActiveMenuTab, setActiveSection, hostCategoryId, menuData, isAllowed, onSectionNavigate, onMenuTabOpen],
  );

  const scrollToSection = useCallback(
    (item) => {
      onSectionNavigate?.(item.sourceCategoryId, item.titleEn, item.domId, {
        source: "nav_click",
        hostCategoryId,
        menuTabId: activeMenuTab,
      });
      document.getElementById(item.domId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [onSectionNavigate, hostCategoryId, activeMenuTab],
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

  const hostMeta = categoryMeta[hostCategoryId];
  const showMenuTabs = menuTabs.length > 0;
  const isDrinks = isDrinksCatalog(sourceCategoryId);

  return (
    <motion.div className="contextual-menu">
      <motion.div className="contextual-nav-stack">
        <motion.div className="contextual-menu-bar contextual-menu-bar-primary">
          {showMenuTabs ? (
            menuTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`contextual-pill ${activeTab?.id === tab.id ? "active" : ""}`}
                onClick={() => scrollToMenuTab(tab)}
              >
                {tab.label}
              </button>
            ))
          ) : isManualMode ? (
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
                  onClick={() => setActiveCategory(catId)}
                >
                  {isArabic ? meta.ar : meta.en}
                </button>
              );
            })
          )}
        </motion.div>

        {isManualMode && showMenuTabs && (
          <motion.div className="contextual-menu-bar contextual-menu-bar-back">
            <button type="button" className="contextual-pill contextual-pill-back" onClick={onBackToContextual}>
              {isArabic ? "القائمة النشطة" : "Active Menu"}
            </button>
          </motion.div>
        )}

        {sectionNavItems.length > 0 &&
          renderSectionNav(
            sectionNavItems,
            "section-nav contextual-section-nav-secondary",
            isArabic ? "أقسام القائمة" : "Menu sections",
          )}
      </motion.div>

      <div id={`nac-menu-${hostCategoryId}`} className="contextual-category-block">
        {hostMeta && (
          <div className="contextual-category-head">
            <h2>{isArabic ? hostMeta.ar : hostMeta.en}</h2>
            <span>{isArabic ? hostMeta.timeAr : hostMeta.timeEn}</span>
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={`${hostCategoryId}-${sourceCategoryId}`}
            className="contextual-menu-panel"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.25, 0.1, 0.25, 1] }}
          >
        {visibleSections.map((sec, sectionIndex) => {
          const sectionDomId = makeSectionDomId(sourceCategoryId, sec.title.en);

          return (
            <section
              key={`${sourceCategoryId}-${sec.title.en}`}
              id={sectionDomId}
              data-section-slug={sectionSlug(sec.title.en)}
              data-category-id={sourceCategoryId}
              className={
                isDrinks
                  ? "drink-section-block contextual-menu-section"
                  : "menu-section contextual-menu-section"
              }
            >
              <h3 className="section-title no-arabic-spacing">{isArabic ? sec.title.ar : sec.title.en}</h3>

              {isDrinks ? (
                <div className="drink-card-grid">
                  {sec.items.map((menuItem, index) => (
                    <DrinkMenuCard
                      key={`${menuItem.en}-${index}`}
                      menuItem={menuItem}
                      categoryId="drinks"
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
                      categoryId={sourceCategoryId}
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
          </motion.div>
        </AnimatePresence>
      </div>

      {visibleSections.length === 0 && (
        <p className="empty-state">{isArabic ? "لا توجد نتائج مطابقة" : "No matching results"}</p>
      )}
    </motion.div>
  );
}
