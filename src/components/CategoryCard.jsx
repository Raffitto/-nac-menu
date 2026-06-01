import { motion } from "framer-motion";
import "./category-card.css";
import {
  BREAKFAST_ICON_EN,
  resolveCategoryIcon,
} from "../lib/menuPresentation";

/**
 * All Menus category tile — one layout for English and Arabic (RTL text only).
 */
export default function CategoryCard({ category, isArabic, onClick, index = 0 }) {
  const title = isArabic ? category.ar : category.en;
  const time = isArabic ? category.timeAr : category.timeEn;
  const iconSrc =
    category.id === "breakfast" && !isArabic
      ? BREAKFAST_ICON_EN
      : resolveCategoryIcon(category, isArabic);

  return (
    <motion.button
      type="button"
      className="nac-category-card"
      onClick={onClick}
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: index * 0.06,
        duration: 0.45,
        ease: "easeOut",
      }}
      whileHover={{ y: -4, scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="nac-category-card__icon-slot" aria-hidden="true">
        <img
          className="nac-category-card__icon"
          src={iconSrc}
          alt=""
          loading="lazy"
          decoding="async"
        />
      </span>
      <span className="nac-category-card__title">{title}</span>
      <small className="nac-category-card__time">{time}</small>
    </motion.button>
  );
}
