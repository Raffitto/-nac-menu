import React, { useEffect, useState, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  runReviewEventsInsertSelfTest,
  trackReviewQrScan,
  trackReviewPageOpen,
  trackReviewGenerate,
  trackReviewCopy,
  trackReviewGoogleClick,
  trackReviewLanguageChange,
} from "../lib/reviewAnalytics";
import {
  buildReviewTrackingContext,
  parseReviewPortalParams,
} from "../lib/reviewPortalParams";
import { fetchReviewPortalStaff } from "../dashboard/utils/unifiedIntelligenceApi";
import {
  canonName,
  generatePersonalizedReview,
  getGoogleReviewUrl,
  withHonorificEN,
  withHonorificAR,
} from "./reviewGenerator";
import "./review-portal.css";

const COPY = {
  en: {
    title: "Your feedback means a lot to us",
    subtitle: "Tap or scan to leave a review",
    placeholder: "Your review text will appear here…",
    generate: "Generate",
    copy: "Copy",
    google: "Google Review",
  },
  ar: {
    title: "ملاحظاتكم تعني لنا الكثير",
    subtitle: "اضغط أو امسح الرمز لترك تقييم",
    placeholder: "سيظهر نص المراجعة هنا…",
    generate: "إنشاء نص آخر",
    copy: "نسخ",
    google: "تقييم قوقل",
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

export default function ReviewPortal() {
  const portalParams = useMemo(() => parseReviewPortalParams(), []);
  const [language, setLanguage] = useState(portalParams.lang === "ar" ? "ar" : "en");
  const [text, setText] = useState("");
  const [staffName, setStaffName] = useState(portalParams.employeeName || "");
  const [staffRole, setStaffRole] = useState(portalParams.employeeRole || "");

  const resolvedStaff = staffName || portalParams.employeeName || "";
  const resolvedRole = staffRole || portalParams.employeeRole || "";
  const displayName = canonName(resolvedStaff);

  const trackingCtx = useMemo(
    () =>
      buildReviewTrackingContext(portalParams, {
        employeeName: staffName || portalParams.employeeName,
        employeeRole: staffRole || portalParams.employeeRole,
      }),
    [portalParams, staffName, staffRole],
  );

  const ctx = useMemo(
    () => ({
      ...trackingCtx,
      employee_role: resolvedRole
        ? String(resolvedRole).trim().toLowerCase()
        : trackingCtx.employee_role,
      storeName: portalParams.storeName,
    }),
    [trackingCtx, resolvedRole, portalParams.storeName],
  );

  const copy = COPY[language] || COPY.en;
  const storeLabel =
    portalParams.storeName ||
    (portalParams.normalizedBranch
      ? `NAC ${portalParams.normalizedBranch.charAt(0).toUpperCase()}${portalParams.normalizedBranch.slice(1)}`
      : "NAC");
  const roleLabel = formatRoleLabel(resolvedRole, language);
  const chipStaffLabel =
    displayName !== "Team"
      ? language === "ar"
        ? withHonorificAR(displayName)
        : withHonorificEN(displayName)
      : language === "ar"
        ? "الموظف"
        : "Staff";

  const googleReviewUrl = useMemo(
    () => getGoogleReviewUrl(portalParams.normalizedBranch),
    [portalParams.normalizedBranch],
  );

  useEffect(() => {
    console.log("PARSED URL PARAMS", {
      raw: typeof window !== "undefined" ? window.location.search : "",
      employeeName: portalParams.employeeName,
      employeeRole: portalParams.employeeRole,
      storeName: portalParams.storeName,
      normalizedBranch: portalParams.normalizedBranch,
    });
    console.log("REVIEW TRACKING CONTEXT (mount)", trackingCtx);

    (async () => {
      await runReviewEventsInsertSelfTest(portalParams.normalizedBranch);
      trackReviewQrScan(trackingCtx);
      trackReviewPageOpen(trackingCtx);
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
  }, [portalParams, trackingCtx, staffName]);

  useEffect(() => {
    const generated = generatePersonalizedReview({
      staffName: displayName,
      role: resolvedRole,
      branchId: portalParams.normalizedBranch,
      language,
    });
    setText(generated);
    trackReviewGenerate(generated.length, { ...ctx, language });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayName, resolvedRole, portalParams.normalizedBranch]);

  const runGenerate = useCallback(() => {
    const generated = generatePersonalizedReview({
      staffName: displayName,
      role: resolvedRole,
      branchId: portalParams.normalizedBranch,
      language,
    });
    setText(generated);
    trackReviewGenerate(generated.length, { ...ctx, language });
  }, [displayName, resolvedRole, portalParams.normalizedBranch, language, ctx]);

  const switchLang = (lang) => {
    setLanguage(lang);
    trackReviewLanguageChange(lang, ctx);
    const generated = generatePersonalizedReview({
      staffName: displayName,
      role: resolvedRole,
      branchId: portalParams.normalizedBranch,
      language: lang,
    });
    setText(generated);
  };

  const handleGoogleClick = (e) => {
    trackReviewGoogleClick({ ...ctx, language });
    if (!googleReviewUrl) {
      e.preventDefault();
      console.error("REVIEW EVENT ERROR", "Missing Google Place ID for branch");
    }
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
              {displayName !== "Team" && (
                <span className="nac-review-chip">{chipStaffLabel}</span>
              )}
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

          <div className="nac-review-text-wrap">
            <textarea
              className="nac-review-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={copy.placeholder}
              dir={language === "ar" ? "rtl" : "ltr"}
            />
          </div>

          <motion.div className="nac-review-actions">
            <motion.button
              type="button"
              className="nac-review-btn nac-review-btn-primary"
              whileTap={{ scale: 0.97 }}
              onClick={runGenerate}
            >
              {copy.generate}
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
              {copy.copy}
            </motion.button>
            <motion.a
              className="nac-review-btn google"
              href={googleReviewUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              whileTap={{ scale: 0.97 }}
              onClick={handleGoogleClick}
            >
              {copy.google}
            </motion.a>
          </motion.div>
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
