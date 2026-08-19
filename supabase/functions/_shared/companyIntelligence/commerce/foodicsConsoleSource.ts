/**
 * Authenticated Foodics console list/detail source for the local Mac bridge.
 * Session material comes from env — never committed to the repository.
 */

import type { FoodicsAuthenticatedSource, FoodicsListing } from "./acquisitionEngine.ts";

export type FoodicsConsoleSourceConfig = {
  baseUrl?: string;
  cookie?: string | null;
  headers?: Record<string, string>;
  branchId?: string;
  fetchImpl?: typeof fetch;
};

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function listingUrl(baseUrl: string, businessDate: string): string {
  const encodedDate = encodeURIComponent(businessDate);
  return `${baseUrl}/core-api/listing?url=/orders&filter[business_date]=${encodedDate}`;
}

function detailUrl(baseUrl: string, orderId: string): string {
  const encodedId = encodeURIComponent(orderId);
  return `${baseUrl}/core-api/getting?url=/orders&id=${encodedId}`;
}

function extractOrderIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const rows = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root)
      ? root
      : Array.isArray(root.orders)
        ? root.orders
        : [];
  return rows
    .map((row) => String((row as { id?: unknown })?.id || ""))
    .filter(Boolean);
}

export function createFoodicsConsoleSource(config: FoodicsConsoleSourceConfig = {}): FoodicsAuthenticatedSource {
  const baseUrl = normalizeBaseUrl(config.baseUrl || "https://console.foodics.com");
  const fetchImpl = config.fetchImpl || fetch;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(config.headers || {}),
  };
  if (config.cookie) headers.Cookie = config.cookie;

  return {
    async listOrders({ businessDate }) {
      const response = await fetchImpl(listingUrl(baseUrl, businessDate), { headers });
      if (!response.ok) {
        throw new Error(`foodics_listing_failed:${response.status}`);
      }
      const payload = await response.json();
      const orderIds = extractOrderIds(payload);
      return { orderIds, listingCount: orderIds.length } satisfies FoodicsListing;
    },
    async fetchOrderDetail({ orderId }) {
      const response = await fetchImpl(detailUrl(baseUrl, orderId), { headers });
      if (!response.ok) {
        throw new Error(`foodics_detail_failed:${response.status}:${orderId}`);
      }
      return response.json();
    },
  };
}

export function foodicsSessionReadyFromEnv(env: Record<string, string | undefined>): boolean {
  const cookie = env.FOODICS_SESSION_COOKIE || env.FOODICS_CONSOLE_COOKIE;
  const token = env.FOODICS_AUTH_TOKEN || env.FOODICS_BEARER_TOKEN;
  const headersJson = env.FOODICS_AUTH_HEADERS_JSON;
  return Boolean(cookie || token || headersJson);
}

export function foodicsConsoleSourceFromEnv(env: Record<string, string | undefined>): FoodicsAuthenticatedSource {
  const headers: Record<string, string> = {};
  const cookie = env.FOODICS_SESSION_COOKIE || env.FOODICS_CONSOLE_COOKIE;
  const token = env.FOODICS_AUTH_TOKEN || env.FOODICS_BEARER_TOKEN;
  if (cookie) headers.Cookie = cookie;
  if (token) headers.Authorization = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  if (env.FOODICS_AUTH_HEADERS_JSON) {
    try {
      const parsed = JSON.parse(env.FOODICS_AUTH_HEADERS_JSON) as Record<string, string>;
      Object.assign(headers, parsed);
    } catch {
      throw new Error("invalid_foodics_auth_headers_json");
    }
  }
  return createFoodicsConsoleSource({
    baseUrl: env.FOODICS_CONSOLE_BASE_URL || env.FOODICS_BASE_URL || "https://console.foodics.com",
    headers,
    cookie: cookie || null,
    branchId: env.FOODICS_BRIDGE_BRANCH_ID || env.FOODICS_BRANCH_ID || "khobar",
  });
}
