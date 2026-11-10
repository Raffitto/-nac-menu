import React, { useEffect, useState } from "react";

const API = process.env.REACT_APP_RESTAURANT_API || "http://127.0.0.1:4193";
const basket = [];
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener());
}

export function guestOrderToken() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("guest-token") || "";
}

async function guestCall(path, body) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

function useBasket() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const listener = () => setTick((value) => value + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return basket;
}

export function GuestTableOrder({ item, isArabic = false }) {
  const token = guestOrderToken();
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [match, setMatch] = useState(null);
  const [modifierIds, setModifierIds] = useState([]);
  const lines = useBasket();
  useEffect(() => {
    if (!token || !item) return undefined;
    let stop = false;
    guestCall("/guest/menu", { token }).then((menu) => {
      if (stop) return;
      if (!menu?.ok) {
        setStatus(isArabic ? "الطلب غير متاح. يمكنك متابعة التصفح." : "Ordering is unavailable. You can keep browsing.");
        return;
      }
      setMatch((menu.items || []).find((row) => row.id === item.id || row.name === item.en) || null);
    }).catch(() => {
      if (!stop) setStatus(isArabic ? "الطلب غير متاح. يمكنك متابعة التصفح." : "Ordering is unavailable. You can keep browsing.");
    });
    return () => { stop = true; };
  }, [token, item, isArabic]);
  if (!token || !item) return null;

  async function add() {
    if (!match) {
      setStatus(isArabic ? "هذا الصنف غير موجود في قائمة الطلب." : "This item is not on the ordering menu.");
      return;
    }
    setStatus(isArabic ? "جارٍ الإضافة…" : "Adding…");
    try {
      const saved = await guestCall("/guest/basket", {
        token,
        itemId: match.id,
        quantity,
        modifierIds,
        note,
        clientKey: `${match.id}:${Date.now()}`,
      });
      if (!saved?.ok) {
        setStatus(saved?.reason || (isArabic ? "تعذر إضافة الصنف." : "The item was not added."));
        return;
      }
      basket.push({ name: match.name, quantity, note });
      notify();
      setStatus(isArabic ? "أضيف إلى سلتك. لم يُرسل للمطبخ." : "Added to your basket. The kitchen has not received it.");
    } catch {
      setStatus(isArabic ? "الطلب غير متاح. يمكنك متابعة التصفح." : "Ordering is unavailable. You can keep browsing.");
    }
  }

  return (
    <div className="guest-order" style={{ marginTop: 12 }}>
      <p>{isArabic ? "جلسة طاولة" : "Table session"} · {lines.length}</p>
      {match?.modifiers?.length > 0 && (
        <div>
          {(match.modifiers || []).map((modifier) => (
            <button
              key={modifier.id}
              type="button"
              aria-pressed={modifierIds.includes(modifier.id)}
              onClick={() => setModifierIds((current) => current.includes(modifier.id) ? current.filter((id) => id !== modifier.id) : [...current, modifier.id])}
            >
              {modifier.name} · {modifier.price}
            </button>
          ))}
        </div>
      )}
      <label>
        {isArabic ? "الكمية" : "Quantity"}
        <input type="number" min="1" max="99" value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
      </label>
      <label>
        {isArabic ? "ملاحظة" : "Note"}
        <input value={note} maxLength={140} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button type="button" onClick={add}>{isArabic ? "أضف إلى الطلب" : "Add to order"}</button>
      {status ? <p role="status">{status}</p> : null}
    </div>
  );
}

export function GuestOrderTray({ isArabic = false }) {
  const token = guestOrderToken();
  const lines = useBasket();
  const [status, setStatus] = useState("");
  if (!token) return null;

  async function submit() {
    setStatus(isArabic ? "جارٍ الإرسال…" : "Sending for confirmation…");
    try {
      const result = await guestCall("/guest/submit", { token, idempotencyKey: `guest-ui:${Date.now()}` });
      if (!result?.ok) {
        setStatus(result?.reason || (isArabic ? "لم يُرسل الطلب." : "The order was not submitted."));
        return;
      }
      setStatus(result.kitchenSubmitted === false
        ? (isArabic ? "بانتظار تأكيد الموظف. المطبخ لم يستلم الطلب." : "Waiting for staff confirmation. The kitchen has not received this order.")
        : (isArabic ? "تم الإرسال." : "Submitted."));
    } catch {
      setStatus(isArabic ? "الطلب غير متاح. القائمة تبقى للتصفح." : "Ordering is unavailable. The menu stays open for browsing.");
    }
  }

  return (
    <aside className="guest-order-tray" aria-label={isArabic ? "سلتك" : "Your basket"} style={{ position: "sticky", bottom: 0, padding: 12 }}>
      <h2>{isArabic ? "سلتك" : "Your basket"}</h2>
      {lines.length === 0 ? <p>{isArabic ? "لا توجد أصناف بعد." : "No items yet."}</p> : (
        <ul>
          {lines.map((line, index) => (
            <li key={`${line.name}-${index}`}>{line.quantity} × {line.name}{line.note ? ` · ${line.note}` : ""}</li>
          ))}
        </ul>
      )}
      <button type="button" onClick={submit} disabled={!lines.length}>{isArabic ? "إرسال لتأكيد الموظف" : "Submit for staff confirmation"}</button>
      {status ? <p role="status">{status}</p> : null}
    </aside>
  );
}
