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
import { markBoot } from "./lib/bootTelemetry";

markBoot("index_start");

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
const InventoryApp = lazy(() => import("./inventory/InventoryApp"));
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
        <InventoryApp />
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
      <Suspense
        fallback={
          <div
            style={{
              minHeight: "100vh",
              background: "#0a0908",
              color: "#f9f9f7",
              fontFamily:
                'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
              padding: "28px 32px",
            }}
          >
            <p style={{ opacity: 0.55, letterSpacing: "0.08em", fontSize: 12, margin: 0 }}>
              NAC HOSPITALITY OS
            </p>
            <h1 style={{ fontWeight: 500, fontSize: "1.75rem", margin: "10px 0 6px" }}>
              Overview
            </h1>
            <p style={{ opacity: 0.5, margin: 0 }}>Loading workspace…</p>
          </div>
        }
      >
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
