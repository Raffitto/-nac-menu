/**
 * NAC OS Intelligence Layer — business reasoning engine.
 * Transforms multi-domain signals into facts, correlations, hypotheses, and recommendations.
 */

import {
  createNilReasoningResult,
  createReasoningStatement,
  EVIDENCE_LEVELS,
  NIL_DOMAINS,
  resetNilStatementCounter,
} from "./nilContract";
import { scoreOverallReasoningConfidence, scoreStatementConfidence } from "./confidenceScoring";
import { normalizeSignalBundle, groupSignalsByDomain } from "./signalFramework";
import "./adapters/internalOperationalAdapter.js";

/**
 * @param {import("./nilContract").NilSignalBundleInput} input
 * @returns {import("./nilContract").NilReasoningResult}
 */
export function businessReasoningEngine(input = {}) {
  resetNilStatementCounter();

  const signals = normalizeSignalBundle(input);
  const grouped = groupSignalsByDomain(signals);

  const facts = extractFacts(signals);
  const correlations = extractCorrelations(signals, grouped);
  const hypotheses = buildHypotheses(facts, correlations, signals);
  const recommendations = buildRecommendations(facts, correlations, hypotheses, signals, input);
  const { confidence, factors } = scoreOverallReasoningConfidence(facts, correlations, hypotheses);

  return createNilReasoningResult({
    facts,
    correlations,
    hypotheses,
    recommendations,
    confidence,
    confidenceFactors: factors,
    meta: {
      question: input.question || "",
      branchLabel: input.branchLabel || "",
      periodLabel: input.periodLabel || "",
      signalCount: signals.length,
      domainsPresent: Object.keys(grouped),
    },
  });
}

function extractFacts(signals = []) {
  return signals
    .filter((signal) => signal.evidenceLevel === EVIDENCE_LEVELS.FACT
      || (signal.domain === NIL_DOMAINS.INTERNAL_OPERATIONAL && signal.type === "metric"))
    .map((signal) => statementFromSignal(signal, EVIDENCE_LEVELS.FACT, {
      agreementCount: 0,
      historicalConsistency: signal.metadata?.historicalConsistency ?? null,
    }))
    .filter((stmt) => stmt.text);
}

function extractCorrelations(signals = [], grouped = {}) {
  const explicit = signals
    .filter((signal) => signal.evidenceLevel === EVIDENCE_LEVELS.CORRELATION
      || signal.type === "observation"
      || signal.type === "event")
    .map((signal) => statementFromSignal(signal, EVIDENCE_LEVELS.CORRELATION, {
      agreementCount: countAgreeingDomains(grouped, signal.domain),
      historicalConsistency: signal.metadata?.historicalConsistency ?? null,
    }))
    .filter((stmt) => stmt.text);

  const derived = deriveCrossDomainCorrelations(grouped);
  return dedupeStatements([...explicit, ...derived]);
}

function deriveCrossDomainCorrelations(grouped) {
  const derived = [];
  const weather = grouped[NIL_DOMAINS.WEATHER] || [];
  const internal = grouped[NIL_DOMAINS.INTERNAL_OPERATIONAL] || [];

  const humidity = weather.find((s) => /humidity/i.test(s.label));
  const salesDown = internal.find((s) => /sales change/i.test(s.label) && s.direction === "down");

  if (humidity && salesDown) {
    const text = `Humidity averaged ${humidity.value}${humidity.unit || "%"} during the same period as the sales decline.`;
    const scored = scoreStatementConfidence({
      sources: [...(humidity.sources || []), ...(salesDown.sources || [])],
      agreementCount: 2,
      historicalConsistency: humidity.metadata?.historicalConsistency ?? 0.55,
    });
    derived.push(createReasoningStatement({
      level: EVIDENCE_LEVELS.CORRELATION,
      text,
      confidence: scored.confidence,
      sources: [...(humidity.sources || []), ...(salesDown.sources || [])],
      supportingSignalIds: [humidity.id, salesDown.id],
      domains: [NIL_DOMAINS.WEATHER, NIL_DOMAINS.INTERNAL_OPERATIONAL],
    }));
  }

  return derived;
}

function buildHypotheses(facts = [], correlations = [], signals = []) {
  const explicit = signals
    .filter((signal) => signal.evidenceLevel === EVIDENCE_LEVELS.HYPOTHESIS)
    .map((signal) => statementFromSignal(signal, EVIDENCE_LEVELS.HYPOTHESIS))
    .filter((stmt) => stmt.text);

  const derived = [];

  const salesDown = findFact(facts, /sales/i, "down");
  const guestsDown = findFact(facts, /guest/i, "down");
  const spendStable = findFact(facts, /average spend|avg spend/i, "stable");
  const spendDown = findFact(facts, /average spend|avg spend/i, "down");
  const deliveryStable = findFact(facts, /delivery performance/i, "stable");
  const deliveryDown = findFact(facts, /delivery sales|delivery orders/i, "down");
  const humidity = correlations.find((c) => /humidity/i.test(c.text));
  const competitorBusy = correlations.find((c) => /competitor|agapi|urth|san carlo|busier/i.test(c.text));
  const locationEvent = correlations.find((c) => /football|mall event|activation|patio/i.test(c.text));

  if (salesDown && guestsDown && spendStable) {
    derived.push(hypothesisStatement(
      "Lower walk-in traffic was likely the primary driver; spend behavior did not materially change.",
      [salesDown, guestsDown, spendStable],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 3, historicalConsistency: 0.6 },
    ));
  } else if (salesDown && guestsDown && spendDown) {
    derived.push(hypothesisStatement(
      "Lower guest traffic may indicate a possible contributor to the sales decline; average spend also declined during the period.",
      [salesDown, guestsDown, spendDown],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 3, historicalConsistency: 0.55 },
    ));
  } else if (salesDown && guestsDown) {
    derived.push(hypothesisStatement(
      "Lower guest traffic may indicate a possible contributor to the sales decline.",
      [salesDown, guestsDown],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 2, historicalConsistency: 0.55 },
    ));
  }

  if (spendDown && guestsDown && !derived.some((h) => /guest traffic|average spend/i.test(h.text))) {
    derived.push(hypothesisStatement(
      "Lower average spend per guest may indicate ticket-size softening alongside fewer guests.",
      [spendDown, guestsDown],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 2, historicalConsistency: 0.5 },
    ));
  }

  if (guestsDown && !salesDown) {
    derived.push(hypothesisStatement(
      "Fewer guests may indicate reduced walk-in or reservation traffic during the period.",
      [guestsDown],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 1, historicalConsistency: 0.5 },
    ));
  }

  if (deliveryDown) {
    derived.push(hypothesisStatement(
      "Delivery channel softness may point toward a possible contributor to the performance change.",
      salesDown ? [deliveryDown, salesDown] : [deliveryDown],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: salesDown ? 2 : 1, historicalConsistency: 0.5 },
    ));
  }

  if (humidity && salesDown) {
    derived.push(hypothesisStatement(
      "Reduced walk-in traffic may have contributed to the sales decline during elevated humidity.",
      [salesDown, humidity],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL, NIL_DOMAINS.WEATHER],
      { agreementCount: 2, historicalConsistency: 0.55 },
    ));
  }

  if (competitorBusy && salesDown) {
    derived.push(hypothesisStatement(
      "Competitor activations or stronger observed competitor traffic may have diverted mall guests.",
      [salesDown, competitorBusy],
      [NIL_DOMAINS.COMPETITIVE, NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 2, historicalConsistency: 0.45 },
    ));
  }

  if (locationEvent && salesDown) {
    derived.push(hypothesisStatement(
      "Nearby mall activations may have shifted guest flow away from the restaurant.",
      [salesDown, locationEvent],
      [NIL_DOMAINS.LOCATION, NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 2, historicalConsistency: 0.5 },
    ));
  }

  if (deliveryStable && salesDown) {
    derived.push(hypothesisStatement(
      "Delivery performance remained stable, suggesting the decline was concentrated in dine-in or walk-in demand.",
      [salesDown, deliveryStable],
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 2, historicalConsistency: 0.65 },
    ));
  }

  if (!derived.length && facts.length) {
    derived.push(hypothesisStatement(
      "Observed cash-up metric changes may indicate multiple internal contributors; additional same-period operational notes would help narrow the driver.",
      facts.slice(0, Math.min(2, facts.length)),
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
      { agreementCount: 1, historicalConsistency: 0.4 },
    ));
  }

  return dedupeStatements([...explicit, ...derived]);
}

function buildRecommendations(facts, correlations, hypotheses, signals, input) {
  const explicit = signals
    .filter((signal) => signal.evidenceLevel === EVIDENCE_LEVELS.RECOMMENDATION)
    .map((signal) => statementFromSignal(signal, EVIDENCE_LEVELS.RECOMMENDATION))
    .filter((stmt) => stmt.text);

  const derived = [];
  const humidity = correlations.find((c) => /humidity/i.test(c.text));
  const competitorBusy = correlations.find((c) => /competitor|agapi|urth|busier/i.test(c.text));
  const salesDown = findFact(facts, /sales/i, "down");

  if (salesDown) {
    derived.push(recommendationStatement(
      "Increase review acquisition during low-traffic days to protect brand visibility.",
      [salesDown],
      [NIL_DOMAINS.BRAND_HEALTH],
    ));
  }

  if (humidity) {
    derived.push(recommendationStatement(
      "Promote delivery channels during high-humidity periods when terrace and walk-in traffic may soften.",
      [humidity],
      [NIL_DOMAINS.WEATHER, NIL_DOMAINS.INTERNAL_OPERATIONAL],
    ));
  }

  if (competitorBusy) {
    derived.push(recommendationStatement(
      "Monitor competitor activations and prepare a same-day response offer when nearby concepts run events.",
      [competitorBusy],
      [NIL_DOMAINS.COMPETITIVE],
    ));
  }

  if (input.question && /why/i.test(input.question) && !derived.length && !explicit.length) {
    derived.push(recommendationStatement(
      "Collect additional operational notes and competitor observations for the same period before acting on a single-driver explanation.",
      facts.slice(0, 1),
      [NIL_DOMAINS.INTERNAL_OPERATIONAL],
    ));
  }

  return dedupeStatements([...explicit, ...derived]);
}

function statementFromSignal(signal, level, scoring = {}) {
  const text = formatSignalText(signal);
  const scored = scoreStatementConfidence({
    sources: signal.sources,
    reliability: signal.reliability,
    agreementCount: scoring.agreementCount || 0,
    historicalConsistency: scoring.historicalConsistency,
  });

  return createReasoningStatement({
    level,
    text,
    confidence: scored.confidence,
    sources: signal.sources,
    supportingSignalIds: [signal.id],
    domains: [signal.domain],
  });
}

function hypothesisStatement(text, supports, domains, scoring = {}) {
  const sources = supports.flatMap((s) => s.sources || []);
  const scored = scoreStatementConfidence({
    sources,
    agreementCount: scoring.agreementCount || supports.length,
    historicalConsistency: scoring.historicalConsistency,
  });

  return createReasoningStatement({
    level: EVIDENCE_LEVELS.HYPOTHESIS,
    text,
    confidence: scored.confidence,
    sources: dedupeSources(sources),
    supportingSignalIds: supports.map((s) => s.id),
    domains,
  });
}

function recommendationStatement(text, supports, domains) {
  const sources = supports.flatMap((s) => s.sources || []);
  const scored = scoreStatementConfidence({
    sources,
    agreementCount: supports.length,
    reliability: 0.55,
  });

  return createReasoningStatement({
    level: EVIDENCE_LEVELS.RECOMMENDATION,
    text,
    confidence: scored.confidence,
    sources: dedupeSources(sources),
    supportingSignalIds: supports.map((s) => s.id),
    domains,
  });
}

function formatSignalText(signal) {
  if (signal.evidenceLevel === EVIDENCE_LEVELS.FACT && signal.type === "metric") {
    if (signal.direction === "stable") return `${signal.label} remained stable`;
    if (signal.direction === "down") return `${signal.label} declined ${String(signal.value).replace(/^-/, "")}`;
    if (signal.direction === "up") return `${signal.label} increased ${signal.value}`;
    return `${signal.label}: ${signal.value}${signal.unit ? ` ${signal.unit}` : ""}`;
  }

  if (signal.type === "observation" || signal.type === "event") {
    const prefix = signal.metadata?.historicalPattern
      ? "Similar conditions historically correlate with "
      : "";
    return `${prefix}${signal.label}${signal.value ? `: ${signal.value}` : ""}`.trim();
  }

  return `${signal.label}${signal.value != null ? `: ${signal.value}` : ""}`.trim();
}

function findFact(facts, pattern, direction = null) {
  return facts.find((fact) => {
    if (!pattern.test(fact.text)) return false;
    if (!direction) return true;
    if (direction === "down") return /declin|decreas|down|negative|-/i.test(fact.text);
    if (direction === "stable") return /stable|unchanged|remained stable|no increase|no change/i.test(fact.text);
    if (direction === "up") return /increas|up|positive|\+/i.test(fact.text);
    return true;
  }) || null;
}

function countAgreeingDomains(grouped, primaryDomain) {
  return Object.keys(grouped).filter((domain) => domain !== primaryDomain && grouped[domain]?.length).length;
}

function dedupeStatements(statements = []) {
  const seen = new Set();
  return statements.filter((stmt) => {
    const key = `${stmt.level}|${stmt.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Boolean(stmt.text);
  });
}

function dedupeSources(sources = []) {
  const seen = new Set();
  return sources.filter((source) => {
    const key = `${source.name}|${source.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
