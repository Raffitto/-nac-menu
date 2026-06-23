/**
 * Parse Teach NAC / Remember this / Save as operator knowledge commands.
 */

const TEACH_PATTERNS = [
  /^teach nac:\s*(.+)$/i,
  /^remember this:\s*(.+)$/i,
  /^save as operator knowledge:\s*(.+)$/i,
];

export function parseTeachNacCommand(question = "") {
  const text = String(question || "").trim();
  for (const pattern of TEACH_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]?.trim()) {
      return {
        fact: match[1].trim(),
        command: text.split(":")[0].trim(),
      };
    }
  }
  return null;
}

export function isTeachNacCommand(question = "") {
  return Boolean(parseTeachNacCommand(question));
}

export function inferOperatorMemoryCategory(fact = "") {
  const text = String(fact).toLowerCase();
  if (/\b(humidity|weather|rain|heat|temperature)\b/.test(text)) return "weather";
  if (/\b(competitor|patio|mall|football)\b/.test(text)) return "competitive";
  if (/\b(kids|policy|after \d|not allowed)\b/.test(text)) return "policy";
  if (/\b(walk-in|traffic|demand|event|ithra|aramco)\b/.test(text)) return "demand_driver";
  return "operational";
}
