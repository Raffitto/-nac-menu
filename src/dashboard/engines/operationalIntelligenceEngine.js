/** Deeper operational signals: hesitation, rapid close, visual confidence */

import { BEHAVIOR } from "../utils/itemBehaviorEngine";

export function buildOperationalIntelligence(funnels = [], biData = null) {
  const byType = biData?.by_event_type || {};
  const modalCloses = Number(byType.modal_drag_close) || 0;
  const itemOpens = Number(byType.item_open) || 0;

  const signals = [];

  funnels.forEach((f) => {
    const imp = f.impressions ?? f.item_impressions ?? 0;
    const opens = f.item_opens ?? f.item_modal_opens ?? 0;
    const orders = f.orders ?? 0;
    const avgDur = f.avg_visible_duration_ms ?? (
      f.impression_sessions > 0 ? f.visible_duration_ms / f.impression_sessions : 0
    );
    const deep = f.deep_interest_rate ?? (imp > 0 ? (opens / imp) * 100 : 0);

    if (f.behavior_type === BEHAVIOR.MENU_TRAP || (imp >= 25 && orders < Math.max(2, imp * 0.03))) {
      signals.push({
        type: "attention_low_sales",
        item_name: f.item_name,
        message: `${f.item_name}: high visual attention but weak sales in this period.`,
        action: f.recommended_action || f.suggestion || "Review price, photo, and description.",
        confidence: f.signal_strength || "Early signal",
      });
    }

    if (f.behavior_type === "Needs Explanation" || (opens >= 12 && orders < 5 && avgDur >= 4000)) {
      signals.push({
        type: "needs_explanation",
        item_name: f.item_name,
        message: `${f.item_name}: guests spend time investigating — may need clearer description or staff prompt.`,
        action: "Shorten copy, add portion clarity, or bundle with a proven seller.",
        confidence: f.confidence || "medium",
      });
    }

    if (imp >= 20 && deep < 10 && orders >= 5) {
      signals.push({
        type: "visual_confidence",
        item_name: f.item_name,
        message: `${f.item_name}: strong sales with low modal opens — the card/photo builds confidence.`,
        action: "Protect hero imagery; test add-ons only if upsell is a goal.",
        confidence: "medium",
      });
    }

    if (imp >= 15 && opens >= 8 && orders < 3) {
      signals.push({
        type: "hesitation",
        item_name: f.item_name,
        message: `${f.item_name}: hesitation pattern — visible interest without matching orders.`,
        action: "Test price, social proof, or staff recommendation.",
        confidence: f.false_positive_risk === "high" ? "low" : "medium",
      });
    }
  });

  if (modalCloses > 0 && itemOpens > 0) {
    const rapidPct = Math.round((modalCloses / itemOpens) * 100);
    if (rapidPct >= 15) {
      signals.push({
        type: "rapid_close",
        item_name: null,
        message: `${rapidPct}% of item opens show quick modal close — guests may be browsing without committing.`,
        action: "Review modal length and first-screen item appeal.",
        confidence: "medium",
      });
    }
  } else if (itemOpens > 10 && modalCloses === 0) {
    signals.push({
      type: "rapid_close",
      item_name: null,
      message: "Requires more interaction data — modal close events not yet available for rapid-close analysis.",
      action: "Continue collecting guest sessions.",
      confidence: "low",
    });
  }

  const bounceOpens = funnels.filter((f) => (f.item_opens || 0) >= 10 && (f.orders || 0) === 0);
  if (bounceOpens.length) {
    signals.push({
      type: "bounce_after_open",
      item_name: bounceOpens[0].item_name,
      message: `${bounceOpens.length} item(s) with opens but no Foodics match — possible browse-without-order or mapping gap.`,
      action: "Verify Foodics mapping and item appeal.",
      confidence: "low",
    });
  }

  return { signals: signals.slice(0, 12) };
}
