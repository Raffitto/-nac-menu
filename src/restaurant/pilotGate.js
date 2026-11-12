const API = process.env.REACT_APP_RESTAURANT_API || "http://127.0.0.1:4193";

export async function readRestaurantPilot(fetchImpl = fetch) {
  try {
    const response = await fetchImpl(`${API}/pilot-status`);
    const body = await response.json();
    return {
      restaurantPilot: body?.restaurantPilot === true,
      guestOrdering: body?.guestOrdering === true,
      guestPayments: body?.guestPayments === true,
    };
  } catch {
    return { restaurantPilot: false, guestOrdering: false, guestPayments: false };
  }
}
