import {
  detectGuestLanguage,
  readGuestLanguage,
  writeGuestLanguage,
  GUEST_LANGUAGE_KEY,
} from "./guestLanguage";

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

test("Arabic device languages open the Arabic menu, including regional variants", () => {
  expect(detectGuestLanguage(["ar-SA", "en-US"])).toBe("ar");
  expect(detectGuestLanguage(["ar-LB"])).toBe("ar");
  expect(detectGuestLanguage(["ar-AE"])).toBe("ar");
  expect(detectGuestLanguage(["ar-EG"])).toBe("ar");
  expect(detectGuestLanguage(["fr-FR", "ar-SA"])).toBe("ar");
});

test("English and unsupported languages fall back to English", () => {
  expect(detectGuestLanguage(["en-GB", "ar-SA"])).toBe("en");
  expect(detectGuestLanguage(["de-DE"])).toBe("en");
  expect(detectGuestLanguage([])).toBe("en");
});

test("a saved manual choice wins over the device language and is not implied by detection", () => {
  const storage = memoryStorage();
  expect(readGuestLanguage(storage, ["ar-SA"])).toBe("ar");
  expect(storage.data[GUEST_LANGUAGE_KEY]).toBeUndefined();
  writeGuestLanguage(storage, "en");
  expect(readGuestLanguage(storage, ["ar-EG"])).toBe("en");
  writeGuestLanguage(storage, "ar");
  expect(readGuestLanguage(storage, ["en-US"])).toBe("ar");
});

test("an unknown saved value is ignored", () => {
  expect(readGuestLanguage(memoryStorage({ [GUEST_LANGUAGE_KEY]: "fr" }), ["en-US"])).toBe("en");
});
