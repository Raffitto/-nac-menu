/**
 * Google Places API (New) — public place details only (rating, review count, name).
 * No Business Profile OAuth.
 */

import {
  BRANCH_GOOGLE_PLACE_IDS,
  GOOGLE_PLACE_BRANCHES,
} from "../config/googleBranchPlaces";

const PLACES_BASE = "https://places.googleapis.com/v1/places";
const FIELD_MASK = "displayName,rating,userRatingCount";
const CACHE_MS = 15 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;

/** @type {Map<string, { at: number, data: object }>} */
const cache = new Map();

function apiKey() {
  return (process.env.REACT_APP_GOOGLE_API_KEY || "").trim();
}

function emptyMetrics(placeId, error = null) {
  return {
    placeId: placeId || null,
    rating: null,
    totalReviews: null,
    displayName: null,
    error,
  };
}

/**
 * @param {string} placeId
 * @returns {Promise<{ placeId: string, rating: number|null, totalReviews: number|null, displayName: string|null, error?: string }>}
 */
export async function getGooglePlaceMetrics(placeId) {
  const id = String(placeId || "").trim();
  if (!id) return emptyMetrics(null, "missing_place_id");

  const key = apiKey();
  if (!key) return emptyMetrics(id, "missing_api_key");

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) {
    return hit.data;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(`${PLACES_BASE}/${encodeURIComponent(id)}`, {
        method: "GET",
        headers: {
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[googlePlaces] fetch failed", res.status, errBody.slice(0, 200));
      const data = emptyMetrics(id, "fetch_failed");
      cache.set(id, { at: Date.now(), data });
      return data;
    }

    const json = await res.json();
    const data = {
      placeId: id,
      rating: typeof json.rating === "number" ? json.rating : null,
      totalReviews:
        typeof json.userRatingCount === "number" ? json.userRatingCount : null,
      displayName: json.displayName?.text || null,
      error: null,
    };
    cache.set(id, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.warn("[googlePlaces] network error", err?.message || err);
    const data = emptyMetrics(id, "network");
    cache.set(id, { at: Date.now(), data });
    return data;
  }
}

/**
 * Fetch Google reputation for one or all branches.
 * @param {string|null} branchId — if set, only that branch; else all configured branches
 * @returns {Promise<Record<string, object>>}
 */
export async function fetchBranchGooglePlaceMetrics(branchId = null) {
  const target = branchId
    ? String(branchId).toLowerCase()
    : null;

  const pairs = GOOGLE_PLACE_BRANCHES.filter((b) =>
    target ? b === target : Boolean(BRANCH_GOOGLE_PLACE_IDS[b]),
  ).map((b) => [b, BRANCH_GOOGLE_PLACE_IDS[b]]);

  const entries = await Promise.all(
    pairs.map(async ([branch, placeId]) => {
      const metrics = await getGooglePlaceMetrics(placeId);
      return [branch, metrics];
    }),
  );

  return Object.fromEntries(entries);
}

export function formatGoogleReviewCount(count) {
  if (count == null || !Number.isFinite(count)) return "—";
  return `${Math.round(count).toLocaleString("en-US")} reviews`;
}

export function formatGoogleRating(rating) {
  if (rating == null || !Number.isFinite(rating)) return null;
  return rating.toFixed(1);
}

/** Batch fetch for competitor place IDs (deduped). */
export async function fetchPlaceMetricsBatch(placeIds = []) {
  const unique = [...new Set(placeIds.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (id) => [id, await getGooglePlaceMetrics(id)]),
  );
  return Object.fromEntries(entries);
}
