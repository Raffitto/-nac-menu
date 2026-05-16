import React, { useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

function isValidSrc(src) {
  return typeof src === "string" && src.trim().length > 0;
}

export default function ImageLightbox({ open, src, alt, onClose }) {
  const safeClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const validSrc = isValidSrc(src);

  useEffect(() => {
    if (!open || !validSrc) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") safeClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, validSrc, safeClose]);

  return (
    <AnimatePresence>
      {open && validSrc && (
        <motion.div
          className="img-lightbox"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={safeClose}
          role="dialog"
          aria-modal="true"
          aria-label={alt || "Image preview"}
        >
          <motion.button
            type="button"
            className="img-lightbox-close"
            onClick={(e) => {
              e.stopPropagation();
              safeClose();
            }}
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <X size={22} />
          </motion.button>
          <motion.img
            src={src.trim()}
            alt={alt || ""}
            className="img-lightbox-photo"
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 80 || info.velocity.y > 500) safeClose();
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
