/** Shared staff name / honorific helpers for review generators. */

export const FEMALE_RECEPTIONISTS = new Set([
  "angel",
  "boyboy",
  "boy boy",
  "lyn",
  "leen",
  "amal",
  "madina",
]);

export const NAME_CANON = {
  "boy boy": "Boyboy",
  boyboy: "Boyboy",
  leen: "Lyn",
  lyn: "Lyn",
  angel: "Angel",
};

export function canonName(raw) {
  const t = (raw || "").trim();
  const low = t.toLowerCase();
  if (NAME_CANON[low]) return NAME_CANON[low];
  if (!t) return "Team";
  return t
    .split(" ")
    .map((x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x))
    .join(" ");
}

function isFemaleReceptionist(name) {
  return FEMALE_RECEPTIONISTS.has(String(name || "").trim().toLowerCase());
}

export function withHonorificEN(name) {
  if (!name || name === "Team") return name;
  return `${isFemaleReceptionist(name) ? "Miss " : "Mr "}${name}`;
}

export function withHonorificAR(name) {
  if (!name || name === "Team") return name;
  return `${isFemaleReceptionist(name) ? "مس " : "مستر "}${name}`;
}
