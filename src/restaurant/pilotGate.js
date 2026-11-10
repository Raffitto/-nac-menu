import { restaurantApiBase } from "./devApi/endpoint";

const CLOSED = { restaurantPilot: false, guestOrdering: false, guestPayments: false };

export async function readRestaurantPilot(fetchImpl = fetch) {
  const base = restaurantApiBase();
  if (!base) return CLOSED;
  try {
    const response = await fetchImpl(`${base}/pilot-status`);
    const body = await response.json();
    return {
      restaurantPilot: body?.restaurantPilot === true,
      guestOrdering: body?.guestOrdering === true,
      guestPayments: body?.guestPayments === true,
    };
  } catch {
    return CLOSED;
  }
}
