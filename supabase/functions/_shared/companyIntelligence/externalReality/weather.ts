import type { DateRange } from "../types.ts";
import { allowExternalCost } from "./costGovernor.ts";
import { resolveBranchLocation } from "./branchLocations.ts";
import { factId, getExternalFact, upsertExternalFact } from "./store.ts";
import type { ExternalContextFact } from "./types.ts";

export type WeatherSummary = {
  meanTempC: number | null;
  maxTempC: number | null;
  meanFeelsLikeC: number | null;
  meanHumidityPct: number | null;
  precipMm: number | null;
  rainDays: number;
  meanWindKph: number | null;
  hotDaysGe38: number;
  source: string;
  sourceUrl: string;
  cached: boolean;
};

export type WeatherFetchDeps = {
  fetchImpl?: typeof fetch;
  nowIso?: string;
};

function shouldSkipLiveFetch() {
  try {
    const g: any = globalThis as any;
    return g.process?.env?.NAC_ALLOW_EXTERNAL_FETCH !== "1"
      && g.Deno?.env?.get?.("NAC_ALLOW_EXTERNAL_FETCH") !== "1";
  } catch {
    return true;
  }
}

const CALL_COUNTER = { n: 0 };

export function weatherExternalCallCount() {
  return CALL_COUNTER.n;
}

export function resetWeatherCallCount() {
  CALL_COUNTER.n = 0;
}

function mean(nums: number[]): number | null {
  const ok = nums.filter((n) => Number.isFinite(n));
  if (!ok.length) return null;
  return Math.round((ok.reduce((a, b) => a + b, 0) / ok.length) * 10) / 10;
}

export async function fetchAlignedWeather(input: {
  branchId: string | null;
  period: DateRange;
  deps?: WeatherFetchDeps;
}): Promise<{ summary: WeatherSummary; facts: ExternalContextFact[]; blocked?: string }> {
  const loc = resolveBranchLocation(input.branchId || "khobar") || resolveBranchLocation("khobar")!;
  const id = factId(["weather", loc.branchId, input.period.startDate, input.period.endDate, "daily"]);
  const cached = getExternalFact(id);
  if (cached) {
    const summary = cached.metadata.summary as WeatherSummary;
    return { summary: { ...summary, cached: true }, facts: [cached] };
  }

  const gate = allowExternalCost(1);
  if (!gate.allowed) {
    return {
      summary: emptySummary(true),
      facts: [],
      blocked: gate.reason,
    };
  }

  const url = [
    "https://archive-api.open-meteo.com/v1/archive",
    `?latitude=${loc.lat}&longitude=${loc.lon}`,
    `&start_date=${input.period.startDate}&end_date=${input.period.endDate}`,
    "&daily=temperature_2m_mean,temperature_2m_max,apparent_temperature_mean,relative_humidity_2m_mean,precipitation_sum,wind_speed_10m_max,weather_code",
    "&timezone=Asia%2FRiyadh",
  ].join("");

  CALL_COUNTER.n += 1;
  if (!input.deps?.fetchImpl && shouldSkipLiveFetch()) {
    return { summary: emptySummary(false), facts: [], blocked: "live_fetch_skipped_offline_test" };
  }
  const fetchImpl = input.deps?.fetchImpl || fetch;
  const res = await fetchImpl(url);
  if (!res.ok) {
    return { summary: emptySummary(false), facts: [], blocked: `open_meteo_http_${res.status}` };
  }
  const body = await res.json() as {
    daily?: Record<string, Array<number | null>>;
  };
  const daily = body.daily || {};
  const temps = (daily.temperature_2m_mean || []).map(Number);
  const maxs = (daily.temperature_2m_max || []).map(Number);
  const feels = (daily.apparent_temperature_mean || []).map(Number);
  const hum = (daily.relative_humidity_2m_mean || []).map(Number);
  const rain = (daily.precipitation_sum || []).map(Number);
  const wind = (daily.wind_speed_10m_max || []).map(Number);
  const summary: WeatherSummary = {
    meanTempC: mean(temps),
    maxTempC: mean(maxs),
    meanFeelsLikeC: mean(feels),
    meanHumidityPct: mean(hum),
    precipMm: mean(rain) != null ? Math.round((rain.reduce((a, b) => a + (Number(b) || 0), 0)) * 10) / 10 : null,
    rainDays: rain.filter((x) => Number(x) > 0.2).length,
    meanWindKph: mean(wind),
    hotDaysGe38: maxs.filter((x) => Number(x) >= 38).length,
    source: "Open-Meteo archive (CC BY 4.0)",
    sourceUrl: "https://open-meteo.com/",
    cached: false,
  };

  const fact = upsertExternalFact({
    id,
    branchId: loc.branchId,
    locationLabel: loc.site,
    type: "weather",
    startAt: input.period.startDate,
    endAt: input.period.endDate,
    metricOrEvent: "daily_weather_summary",
    value: summary.meanTempC,
    units: "C",
    source: "open_meteo_archive",
    sourceUrl: summary.sourceUrl,
    fetchedAt: input.deps?.nowIso || new Date().toISOString(),
    immutableHistorical: true,
    quality: "high",
    metadata: { summary, lat: loc.lat, lon: loc.lon, attribution: "Weather data by Open-Meteo.com (CC BY 4.0)" },
  }).fact;

  return { summary, facts: [fact] };
}

function emptySummary(cached: boolean): WeatherSummary {
  return {
    meanTempC: null,
    maxTempC: null,
    meanFeelsLikeC: null,
    meanHumidityPct: null,
    precipMm: null,
    rainDays: 0,
    meanWindKph: null,
    hotDaysGe38: 0,
    source: "open_meteo_archive",
    sourceUrl: "https://open-meteo.com/",
    cached,
  };
}
