function divRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator) || numerator < 0 || !Number.isInteger(denominator) || denominator <= 0) return null;
  return Math.floor((numerator + Math.floor(denominator / 2)) / denominator);
}

function inclusiveVat(grossMinor, rateNumerator = 15, rateDenominator = 100) {
  if (!Number.isInteger(grossMinor) || grossMinor < 0) return null;
  if (!Number.isInteger(rateNumerator) || rateNumerator < 0 || !Number.isInteger(rateDenominator) || rateDenominator <= 0) return null;
  const vatMinor = divRoundHalfUp(grossMinor * rateNumerator, rateDenominator + rateNumerator);
  if (vatMinor == null || vatMinor > grossMinor) return null;
  return {
    treatment: "inclusive",
    grossMinor,
    vatMinor,
    taxableMinor: grossMinor - vatMinor,
    rateNumerator,
    rateDenominator,
  };
}

function percentMinor(baseMinor, percent) {
  if (!Number.isInteger(baseMinor) || baseMinor < 0 || !Number.isInteger(percent) || percent < 0 || percent > 100) return null;
  return divRoundHalfUp(baseMinor * percent, 100);
}

function equalSplit(totalMinor, parts) {
  if (!Number.isInteger(totalMinor) || totalMinor < 0 || !Number.isInteger(parts) || parts < 2 || parts > 12) return null;
  const base = Math.floor(totalMinor / parts);
  const remainder = totalMinor - base * parts;
  const shares = [];
  for (let index = 0; index < parts; index += 1) {
    shares.push(base + (index === parts - 1 ? remainder : 0));
  }
  return shares;
}

function sumMinor(values) {
  if (!Array.isArray(values) || values.some((value) => !Number.isInteger(value) || value < 0)) return null;
  return values.reduce((sum, value) => sum + value, 0);
}

function amountStillOwed(payableMinor, paymentMinor) {
  if (!Number.isInteger(payableMinor) || payableMinor < 0 || !Number.isInteger(paymentMinor) || paymentMinor < 0) return null;
  if (paymentMinor > payableMinor) return null;
  return payableMinor - paymentMinor;
}

function canSettle(payableMinor, paymentMinor) {
  return Number.isInteger(payableMinor) && payableMinor >= 0 && paymentMinor === payableMinor;
}

module.exports = {
  divRoundHalfUp,
  inclusiveVat,
  percentMinor,
  equalSplit,
  sumMinor,
  amountStillOwed,
  canSettle,
};
