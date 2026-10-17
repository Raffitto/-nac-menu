import { readGuestLanguage, writeGuestLanguage, GUEST_LANGUAGE_KEY } from "./guestLanguage";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
    data,
  };
}

test("a new guest starts in English even when storage is empty", () => {
  expect(readGuestLanguage(memoryStorage())).toBe("en");
  expect(readGuestLanguage(null)).toBe("en");
});

test("a saved Arabic choice survives and English can be saved again", () => {
  const storage = memoryStorage({ [GUEST_LANGUAGE_KEY]: "ar" });
  expect(readGuestLanguage(storage)).toBe("ar");
  writeGuestLanguage(storage, "en");
  expect(readGuestLanguage(storage)).toBe("en");
  writeGuestLanguage(storage, "ar");
  expect(storage.data[GUEST_LANGUAGE_KEY]).toBe("ar");
});

test("an unknown saved value falls back to English", () => {
  expect(readGuestLanguage(memoryStorage({ [GUEST_LANGUAGE_KEY]: "fr" }))).toBe("en");
});
