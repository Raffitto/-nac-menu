/**
 * Manually curated competitive set — same guest psychology, not “nearby restaurants.”
 * Verify placeId values in Google Maps Place ID finder when adding entries.
 *
 * @typedef {'direct'|'traffic'|'reputation'} CompetitorType
 * @typedef {object} CompetitorEntry
 * @property {string} id
 * @property {string} name
 * @property {string} placeId — Google Place ID (Places API New)
 * @property {CompetitorType} type
 * @property {string} category
 * @property {string} distance — contextual battlefield (mall, district, mood)
 * @property {boolean} [premiumPositioning]
 * @property {string} [socialMood]
 * @property {string} [outingPurpose]
 */

/** @type {Record<string, CompetitorEntry[]>} */
export const COMPETITORS = {
  khobar: [
    {
      id: "barns-khobar",
      name: "Barn's",
      placeId: "",
      type: "direct",
      category: "Premium café · dessert ritual",
      distance: "Eastern Province · mall & boulevard traffic",
      premiumPositioning: true,
      socialMood: "Social coffee & sweets",
      outingPurpose: "Afternoon premium café",
    },
    {
      id: "joe-juice-khobar",
      name: "Joe & The Juice",
      placeId: "",
      type: "traffic",
      category: "Premium juice & café",
      distance: "Khobar · young affluent traffic",
      premiumPositioning: true,
      socialMood: "Health-luxury lifestyle",
    },
    {
      id: "steak-luxury-khobar",
      name: "Premium steak & grill concepts",
      placeId: "",
      type: "reputation",
      category: "Luxury casual dinner",
      distance: "Same wallet · dinner occasion",
      premiumPositioning: true,
      outingPurpose: "Date-night & celebration dining",
    },
  ],
  riyadh: [
    {
      id: "laduree-laysen",
      name: "Ladurée",
      placeId: "",
      type: "direct",
      category: "Luxury café · macarons",
      distance: "Laysen Valley · same mall psychology",
      premiumPositioning: true,
      socialMood: "Instagram dessert prestige",
      outingPurpose: "Premium café & gifting",
    },
    {
      id: "arabica-riyadh",
      name: "% Arabica",
      placeId: "ChIJZ-7uYOh64jrrVydOdOd57Vc",
      type: "direct",
      category: "Specialty coffee flagship",
      distance: "Riyadh roastery · coffee connoisseurs",
      premiumPositioning: true,
      socialMood: "Minimal luxury coffee culture",
    },
    {
      id: "paul-riyadh",
      name: "PAUL",
      placeId: "",
      type: "traffic",
      category: "French bakery café",
      distance: "Premium mall corridors",
      premiumPositioning: true,
      socialMood: "European café ritual",
    },
  ],
  jeddah: [
    {
      id: "barns-jeddah",
      name: "Barn's",
      placeId: "",
      type: "direct",
      category: "Luxury dessert café",
      distance: "Jeddah social dining circuit",
      premiumPositioning: true,
      socialMood: "Family & social sweets",
    },
    {
      id: "joe-juice-jeddah",
      name: "Joe & The Juice",
      placeId: "",
      type: "traffic",
      category: "Premium juice bar",
      distance: "Coastal affluent zones",
      premiumPositioning: true,
    },
    {
      id: "social-lounge-jeddah",
      name: "Luxury social lounge concepts",
      placeId: "",
      type: "reputation",
      category: "Evening social luxury",
      distance: "Same TikTok dinner mood",
      premiumPositioning: true,
      socialMood: "Night-out prestige",
    },
  ],
};

export const COMPETITOR_BRANCHES = ["khobar", "riyadh", "jeddah"];

export const THREAT_LEVELS = {
  critical: { label: "Critical", order: 0 },
  high: { label: "High", order: 1 },
  watch: { label: "Watch", order: 2 },
  low: { label: "Low", order: 3 },
  advantage: { label: "NAC leads", order: 4 },
};

export function competitorsForBranch(branchId) {
  const id = String(branchId || "").toLowerCase();
  return (COMPETITORS[id] || []).filter((c) => c && c.name);
}

export function allCompetitorEntries() {
  return COMPETITOR_BRANCHES.flatMap((b) =>
    competitorsForBranch(b).map((c) => ({ ...c, branchId: b })),
  );
}
