import "./nacBoot";
import "./lib/reviewAnalytics";
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import {
  applyReviewRoutingMode,
  detectReviewQrMode,
} from "./lib/reviewPortalParams";

// Route BEFORE loading menu App (prevents qr_session_start / menu_events).
const isReviewQr =
  typeof window !== "undefined" &&
  (window.__NAC_REVIEW_MODE__ === true ||
    detectReviewQrMode(window.location.search, window.location.hostname));

applyReviewRoutingMode(isReviewQr);

const ReviewPortal = lazy(() => import("./review/ReviewPortal"));
const MenuApp = lazy(() => import("./App"));

const root = ReactDOM.createRoot(document.getElementById("root"));

if (isReviewQr) {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0908" }} />}>
        <ReviewPortal />
      </Suspense>
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#f9f9f7" }} />}>
        <MenuApp />
      </Suspense>
    </React.StrictMode>,
  );
}

if (!isReviewQr) {
  import("./reportWebVitals").then(({ default: reportWebVitals }) => {
    reportWebVitals();
  });
}
