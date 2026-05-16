import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  trackReviewPageOpen,
  trackReviewGenerate,
  trackReviewRegenerate,
  trackReviewCopy,
  trackReviewGoogleClick,
  trackReviewLanguageChange,
} from "../lib/reviewAnalytics";
import { fetchReviewPortalStaff } from "../dashboard/utils/unifiedIntelligenceApi";
import "./review-portal.css";

function parsePortalParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    branch: (p.get("branch") || process.env.REACT_APP_NAC_BRANCH_ID || "khobar").toLowerCase(),
    employee: p.get("employee") || p.get("name") || "",
    role: p.get("role") || "",
    slug: p.get("slug") || "",
    lang: p.get("lang") || "en",
  };
}

const SAMPLE_REVIEWS = {
  en: "An exceptional dining experience at NAC — attentive service, beautiful presentation, and flavors that linger.",
  ar: "تجربة طعام استثنائية في NAC — خدمة راقية وتقديم جميل ونكهات لا تُنسى.",
};

export default function ReviewPortal() {
  const [params] = useState(parsePortalParams);
  const [language, setLanguage] = useState(params.lang === "ar" ? "ar" : "en");
  const [text, setText] = useState("");
  const [staffName, setStaffName] = useState(params.employee);
  const [staffRole, setStaffRole] = useState(params.role);

  const ctx = useMemo(
    () => ({
      branch_id: params.branch,
      employee_name: staffName || null,
      employee_role: staffRole || null,
    }),
    [params.branch, staffName, staffRole]
  );

  useEffect(() => {
    trackReviewPageOpen(ctx);
    if (params.slug && !staffName) {
      fetchReviewPortalStaff(params.branch)
        .then((rows) => {
          const match = rows.find((r) => r.url_slug === params.slug);
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
    [language, ctx]
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

        <div className="nac-review-actions">
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
        </div>
      </motion.div>
    </div>
  );
}
