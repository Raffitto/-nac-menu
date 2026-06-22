/**
 * Restaurant vocabulary normalization — maps GM language to canonical metric terms
 * before deterministic intent routing and vault period resolution.
 *
 * Order matters: more specific phrases first.
 */

/** @type {[RegExp, string][]} */
export const BUSINESS_SEMANTICS_REPLACEMENTS: [RegExp, string][] = [
  [/how much did we make\b/gi, "what were net sales"],
  [/how much (?:money|revenue) did we (?:make|earn|do)\b/gi, "what were net sales"],
  [/how much did we sell\b/gi, "what were net sales"],
  [/total revenue\b/gi, "net sales"],
  [/\bbranch revenue\b/gi, "branch net sales"],
  [/(?<!\bbranch\s)\brevenue\b/gi, "net sales"],
  [/\bhow much sales\b/gi, "what were net sales"],
  [/(?<!\bbranch\s)(?<!\bdelivery\s)(?<!\bnet\s)(?<!\bcategory\s)(?<!\btop\s)\bsales\b/gi, "net sales"],
  [/\bguest count\b/gi, "guest count"],
  [/\bcovers\b/gi, "guest count"],
  [/\bguests\b/gi, "guest count"],
  [/\bchecks\b/gi, "orders"],
  [/\baverage check\b/gi, "average spend"],
  [/\bavg check\b/gi, "average spend"],
  [/\bspend per guest\b/gi, "average spend per guest"],
  [/\bgoogle rating\b/gi, "google business rating"],
  [/\bhungerstation\b/gi, "hunger delivery platform"],
  [/\bhunger station\b/gi, "hunger delivery platform"],
  [/\bhunger\b(?!\s*delivery)/gi, "hunger delivery platform"],
  [/\bjahez\b/gi, "jahez delivery platform"],
  [/\btalabat\b/gi, "talabat delivery platform"],
  [/\bdelivery apps\b/gi, "delivery platforms"],
  [/\bdelivery app\b/gi, "delivery platform"],
  [/\bplatforms\b(?=.*\bdelivery)/gi, "delivery platforms"],
  [/\bplatform\b(?=.*\bdelivery)/gi, "delivery platform"],
  [/\bdelivery\b(?!\s+(sales|orders|platform|mix|apps?|platforms?))/gi, "delivery sales"],
];

export function applyBusinessSemantics(text = "") {
  let out = String(text || "");
  const appliedRules: string[] = [];

  for (const [pattern, replacement] of BUSINESS_SEMANTICS_REPLACEMENTS) {
    if (pattern.test(out)) {
      out = out.replace(pattern, replacement);
      appliedRules.push(String(pattern));
    }
  }

  return {
    text: out.trim().replace(/\s+/g, " "),
    appliedRules,
  };
}
