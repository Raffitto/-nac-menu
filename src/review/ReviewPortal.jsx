import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  trackReviewQrScan,
  trackReviewPageOpen,
  trackReviewGenerate,
  trackReviewRegenerate,
  trackReviewCopy,
  trackReviewGoogleClick,
  trackReviewLanguageChange,
} from "../lib/reviewAnalytics";
import { parseReviewPortalParams } from "../lib/reviewPortalParams";
import { fetchReviewPortalStaff } from "../dashboard/utils/unifiedIntelligenceApi";
import "./review-portal.css";

const SAMPLE_REVIEWS = {
  en: "An exceptional dining experience at NAC — attentive service, beautiful presentation, and flavors that linger.",
  ar: "تجربة طعام استثنائية في NAC — خدمة راقية وتقديم جميل ونكهات لا تُنسى.",
};

export default function ReviewPortal() {
  const portalParams = useMemo(() => parseReviewPortalParams(), []);
  const [language, setLanguage] = useState(portalParams.lang === "ar" ? "ar" : "en");
  const [text, setText] = useState("");
  const [staffName, setStaffName] = useState(portalParams.employeeName || "");
  const [staffRole, setStaffRole] = useState(portalParams.employeeRole || "");

  const ctx = useMemo(
    () => ({
      branch_id: portalParams.normalizedBranch,
      employee_name: staffName || portalParams.employeeName || null,
      employee_role: staffRole || portalParams.employeeRole || null,
      storeName: portalParams.storeName,
    }),
    [portalParams, staffName, staffRole],
  );

  useEffect(() => {
    console.log("QR PARAMS", {
      storeName: portalParams.storeName,
      normalizedBranch: portalParams.normalizedBranch,
      employeeName: portalParams.employeeName,
      employeeRole: portalParams.employeeRole,
    });

    trackReviewQrScan(ctx);
    trackReviewPageOpen(ctx);

    if (portalParams.slug && !staffName && !portalParams.employeeName) {
      fetchReviewPortalStaff(portalParams.normalizedBranch)
        .then((rows) => {
          const match = rows.find((r) => r.url_slug === portalParams.slug);
          if (match) {
            setStaffName(match.employee_name);
            setStaffRole(match.role);
          }
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = useCallback(
    (isRegen) => {
      const sample = SAMPLE_REVIEWS[language] || SAMPLE_REVIEWS.en;
      setText(sample);
      if (isRegen) trackReviewRegenerate(sample.length, { ...ctx, language });
      else trackReviewGenerate(sample.length, { ...ctx, language });
    },
    [language, ctx],
  );

  const switchLang = (lang) => {
    setLanguage(lang);
    trackReviewLanguageChange(lang, ctx);
  };

  return (
    <div className="nac-review-portal">
      <motion.div
        className="nac-review-card"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <p className="nac-review-brand">NAC</p>
        <h1>Share your experience</h1>
        {staffName && <p className="nac-review-staff">with {staffName}</p>}

        <motion.div className="nac-review-lang">
          <button type="button" className={language === "en" ? "active" : ""} onClick={() => switchLang("en")}>
            English
          </button>
          <button type="button" className={language === "ar" ? "active" : ""} onClick={() => switchLang("ar")}>
            العربية
          </button>
        </motion.div>

        <textarea
          className="nac-review-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={language === "ar" ? "سيظهر نص المراجعة هنا…" : "Your review text will appear here…"}
          dir={language === "ar" ? "rtl" : "ltr"}
        />

        <motion.div className="nac-review-actions">
          <motion.button type="button" className="nac-review-btn primary" whileTap={{ scale: 0.97 }} onClick={() => generate(false)}>
            Generate
          </motion.button>
          <motion.button type="button" className="nac-review-btn" whileTap={{ scale: 0.97 }} onClick={() => generate(true)}>
            Regenerate
          </motion.button>
          <motion.button
            type="button"
            className="nac-review-btn"
            whileTap={{ scale: 0.97 }}
            onClick={() => {
              if (text) navigator.clipboard?.writeText(text);
              trackReviewCopy({ ...ctx, language });
            }}
          >
            Copy
          </motion.button>
          <motion.a
            className="nac-review-btn google"
            href="https://g.page"
            target="_blank"
            rel="noopener noreferrer"
            whileTap={{ scale: 0.97 }}
            onClick={() => trackReviewGoogleClick({ ...ctx, language })}
          >
            Google Review
          </motion.a>
        </motion.div>
      </motion.div>
    </div>
  );
}
