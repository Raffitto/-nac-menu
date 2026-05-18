import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  runReviewEventsInsertSelfTest,
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

const COPY = {
  en: {
    title: "Your feedback means a lot to us",
    subtitle: "Tap or scan to leave a review",
    placeholder: "Your review text will appear here…",
  },
  ar: {
    title: "ملاحظاتكم تعني لنا الكثير",
    subtitle: "اضغط أو امسح الرمز لترك تقييم",
    placeholder: "سيظهر نص المراجعة هنا…",
  },
};

const ROLE_LABELS = {
  rm: { en: "Restaurant Manager", ar: "مدير المطعم" },
  arm: { en: "Assistant Restaurant Manager", ar: "مساعد مدير المطعم" },
  supervisor: { en: "Supervisor", ar: "مشرف" },
  receptionist: { en: "Receptionist", ar: "موظفة استقبال" },
  waiter: { en: "Waiter", ar: "نادل" },
  "training waiter": { en: "Training Waiter", ar: "نادل تحت التدريب" },
  team: { en: "Team", ar: "الفريق" },
};

function formatRoleLabel(role, lang) {
  if (!role || !String(role).trim()) return lang === "ar" ? "الفريق" : "Team";
  const key = String(role).trim().toLowerCase();
  const mapped = ROLE_LABELS[key];
  if (mapped) return mapped[lang] || mapped.en;
  const pretty = String(role).trim();
  return pretty.charAt(0).toUpperCase() + pretty.slice(1);
}

function formatStaffName(name) {
  if (!name || !String(name).trim()) return null;
  const t = String(name).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

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

  const copy = COPY[language] || COPY.en;
  const displayName = formatStaffName(staffName || portalParams.employeeName);
  const storeLabel =
    portalParams.storeName ||
    (portalParams.normalizedBranch
      ? `NAC ${portalParams.normalizedBranch.charAt(0).toUpperCase()}${portalParams.normalizedBranch.slice(1)}`
      : "NAC");
  const roleLabel = formatRoleLabel(staffRole || portalParams.employeeRole, language);

  useEffect(() => {
    console.log("QR PARAMS", {
      storeName: portalParams.storeName,
      normalizedBranch: portalParams.normalizedBranch,
      employeeName: portalParams.employeeName,
      employeeRole: portalParams.employeeRole,
    });

    (async () => {
      await runReviewEventsInsertSelfTest(portalParams.normalizedBranch);
      trackReviewQrScan(ctx);
      trackReviewPageOpen(ctx);
    })();

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
    <motion.div className="nac-review-portal">
      <motion.div className="nac-review-wrap">
        <motion.div
          className={`nac-review-card ${language === "ar" ? "nac-review-card--ar" : ""}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <motion.div className="nac-review-top">
            <img className="nac-review-logo" src="/logo.png" alt="NAC" />
            <motion.div className="nac-review-chips">
              <span className="nac-review-chip">{storeLabel}</span>
              <span className="nac-review-chip">{roleLabel}</span>
              {displayName && <span className="nac-review-chip">{displayName}</span>}
            </motion.div>
            <motion.div className="nac-review-lang">
              <button
                type="button"
                className={language === "en" ? "active" : ""}
                onClick={() => switchLang("en")}
              >
                English
              </button>
              <button
                type="button"
                className={language === "ar" ? "active" : ""}
                onClick={() => switchLang("ar")}
              >
                العربية
              </button>
            </motion.div>
          </motion.div>

          <h1>{copy.title}</h1>
          <p className="nac-review-sub">{copy.subtitle}</p>

          <textarea
            className="nac-review-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={copy.placeholder}
            dir={language === "ar" ? "rtl" : "ltr"}
          />

          <motion.div className="nac-review-actions">
            <motion.button
              type="button"
              className="nac-review-btn"
              whileTap={{ scale: 0.97 }}
              onClick={() => generate(false)}
            >
              Generate
            </motion.button>
            <motion.button
              type="button"
              className="nac-review-btn"
              whileTap={{ scale: 0.97 }}
              onClick={() => generate(true)}
            >
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
      </motion.div>
    </motion.div>
  );
}
