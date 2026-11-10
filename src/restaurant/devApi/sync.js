/** How often a visible restaurant screen asks for state. Hidden screens do not poll. */
export function restaurantSyncIntervalMs(role) {
  if (role === "waiter" || role === "kitchen") return 4000;
  if (role === "host" || role === "cashier") return 8000;
  return 20000;
}

export function createRestaurantSync({ pull, isHidden = () => false }) {
  let inflight = null;
  let stopped = false;

  function request(force) {
    if (stopped) return Promise.resolve("stopped");
    if (!force && isHidden()) return Promise.resolve("paused");
    if (inflight) return inflight;
    inflight = Promise.resolve(pull()).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return { request };
}
