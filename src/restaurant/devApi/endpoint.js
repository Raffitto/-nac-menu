export function resolveRestaurantApiBase({ api = "", hosted = "", localBase = "" } = {}) {
  const configured = String(api || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  if (hosted === "1") return "/api/restaurant";
  return localBase;
}

export function restaurantApiBase() {
  const configured = String(process.env.REACT_APP_RESTAURANT_API || "").trim().replace(/\/$/, "");
  if (configured) return configured;
  if (process.env.REACT_APP_RESTAURANT_HOSTED === "1") return "/api/restaurant";
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:4193";
  return "";
}

export function usesHostedRestaurantAuth() {
  return process.env.REACT_APP_RESTAURANT_HOSTED === "1";
}
