import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { createItemImpressionRef, makeImpressionProps } from "../lib/itemImpression";

export default function ImpressionTracked({
  asMotion = true,
  className,
  onClick,
  children,
  layoutId,
  variants,
  categoryId,
  sectionTitleEn,
  menuItem,
  language,
  enabled = true,
  itemIndex = null,
  sectionIndex = null,
  ...rest
}) {
  const impProps = useMemo(
    () => makeImpressionProps({ categoryId, sectionTitleEn, menuItem, language, enabled, itemIndex, sectionIndex }),
    [categoryId, sectionTitleEn, menuItem, language, enabled, itemIndex, sectionIndex],
  );

  const impressionRef = useMemo(() => createItemImpressionRef(impProps), [impProps]);

  if (asMotion) {
    return (
      <motion.div
        ref={impressionRef}
        layoutId={layoutId}
        className={className}
        onClick={onClick}
        variants={variants}
        {...rest}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <div
      ref={impressionRef}
      className={className}
      onClick={onClick}
      {...rest}
    >
      {children}
    </div>
  );
}
