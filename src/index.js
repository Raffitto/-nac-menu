import "./nacBoot";
import "./lib/reviewAnalytics";
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import {
  applyReviewRoutingMode,
  detectReviewQrMode,
} from "./lib/reviewPortalParams";
import { resolveRootAppKind } from "./lib/platformMode";

// Route BEFORE loading menu App (prevents qr_session_start / menu_events).
const isReviewQr =
  typeof window !== "undefined" &&
  (window.__NAC_REVIEW_MODE__ === true ||
    detectReviewQrMode(window.location.search, window.location.hostname));

applyReviewRoutingMode(isReviewQr);

const ReviewPortal = lazy(() => import("./review/ReviewPortal"));
const LeaderboardView = lazy(() => import("./dashboard/LeaderboardView"));
const ResetPasswordView = lazy(() => import("./dashboard/views/ResetPasswordView"));
const AdminDashboard = lazy(() => import("./dashboard/AdminDashboard"));
const InvoiceIntakeView = lazy(() => import("./inventory/InvoiceIntakeView"));
const MenuApp = lazy(() => import("./App"));

const root = ReactDOM.createRoot(document.getElementById("root"));

const rootKind =
  typeof window !== "undefined"
    ? resolveRootAppKind({
        pathname: window.location.pathname,
        isReviewQr,
      })
    : "public-menu";

if (rootKind === "reset-password") {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0908" }} />}>
        <ResetPasswordView />
      </Suspense>
    </React.StrictMode>,
  );
} else if (rootKind === "leaderboard") {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0908" }} />}>
        <LeaderboardView />
      </Suspense>
    </React.StrictMode>,
  );
} else if (rootKind === "inventory") {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0d1112" }} />}>
        <InvoiceIntakeView />
      </Suspense>
    </React.StrictMode>,
  );
} else if (rootKind === "review") {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0908" }} />}>
        <ReviewPortal />
      </Suspense>
    </React.StrictMode>,
  );
} else if (rootKind === "admin") {
  root.render(
    <React.StrictMode>
      <Suspense fallback={<div style={{ minHeight: "100vh", background: "#0a0908" }} />}>
        <AdminDashboard />
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

if (rootKind !== "review") {
  import("./reportWebVitals").then(({ default: reportWebVitals }) => {
    reportWebVitals();
  });
}
