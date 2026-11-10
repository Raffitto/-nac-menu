import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GUEST_ORDER_MODE = "staff_confirmation";
const TTL_MS = 2 * 60 * 60 * 1000;

function secret() {
  const value = process.env.LOCAL_GUEST_TOKEN_SECRET;
  if (!value) throw new Error("guest_token_secret_missing");
  return value;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function issueGuestToken({ sessionId, tableId, branchId, accessId }) {
  const exp = Date.now() + TTL_MS;
  const token = sign({ v: 1, sid: sessionId, tid: tableId, bid: branchId, aid: accessId, exp, nonce: randomBytes(8).toString("hex") });
  return { token, expiresAt: new Date(exp).toISOString() };
}

export function readGuestToken(token) {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) throw new Error("guest_access_invalid");
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("guest_access_invalid");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload?.exp || payload.exp < Date.now()) throw new Error("guest_access_expired");
  return payload;
}

export function guestMenu(menu, addonById, addonIdsByItem, allergenIdsByItem) {
  return (menu.items || []).filter((item) => item.active !== false && item.sold_out !== true).map((item) => {
    const modifierIds = [...(addonIdsByItem.get(String(item.id)) || [])];
    return {
      id: item.id,
      name: item.name_en || item.name || null,
      price: item.price ?? null,
      allergens: allergenIdsByItem.get(String(item.id)) || [],
      availableFrom: item.available_from || null,
      availableUntil: item.available_until || null,
      modifiers: modifierIds.map((id) => {
        const addon = addonById.get(String(id));
        return addon && addon.active !== false ? { id, name: addon.name_en || addon.name || null, price: addon.price ?? null } : null;
      }).filter(Boolean),
      requiredModifiers: [],
    };
  }).filter((item) => item.name);
}
