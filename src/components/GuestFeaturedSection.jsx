import React from "react";
import { motion } from "framer-motion";
import FoodMenuCard from "./FoodMenuCard";
import DrinkMenuCard from "./DrinkMenuCard";
import { isDrinksCatalog } from "../lib/menuPresentation";

export default function GuestFeaturedSection({
  items,
  isArabic,
  lang,
  onOpenItem,
}) {
  if (!items.length) return null;

  return (
    <section
      className="guest-featured-section"
      data-testid="guest-featured-section"
      aria-label={isArabic ? "موصى به" : "Recommended"}
    >
      <div className="guest-featured-head">
        <h3 className="guest-featured-title">
          {isArabic ? "موصى به" : "Recommended"}
        </h3>
        <p className="guest-featured-subtitle">
          {isArabic
            ? "أطباق مميزة من قائمتنا"
            : "Chef highlights from our menu"}
        </p>
      </div>

      <motion.div
        className="menu-grid menu-grid-compact guest-featured-grid"
        initial="show"
        animate="show"
        variants={{ show: { transition: { staggerChildren: 0.04 } } }}
      >
        {items.map((item, index) => {
          const Card = isDrinksCatalog(item.categoryId) ? DrinkMenuCard : FoodMenuCard;
          return (
            <Card
              key={featuredRowKey(item, index)}
              menuItem={item}
              categoryId={item.categoryId}
              sectionTitleEn={item.sectionTitleEn}
              sectionIndex={-1}
              itemIndex={index}
              language={lang}
              isArabic={isArabic}
              enabled
              highlighted
              onOpenItem={onOpenItem}
              variants={{
                hidden: { opacity: 0, y: 12 },
                show: { opacity: 1, y: 0 },
              }}
            />
          );
        })}
      </motion.div>
    </section>
  );
}

function featuredRowKey(item, index) {
  return item.placementGroupId || item.id || `${item.en}-${index}`;
}
