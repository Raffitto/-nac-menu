import { DAYPARTS } from "../config/attachmentThresholds";
import {
  hourInRiyadh,
  formatHourBucketLabel,
  parseHourBucket,
} from "../utils/hourlyBucketLabels";

const RIYADH = "Asia/Riyadh";

function weekdayInRiyadh(iso) {
  if (!iso) return "weekday";
  try {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: RIYADH, weekday: "short" }).format(
      new Date(iso),
    );
    return wd === "Fri" || wd === "Sat" ? "weekend" : "weekday";
  } catch {
    return "weekday";
  }
}

export function hourToDaypart(hour) {
  const h = Number(hour);
  if (Number.isNaN(h)) return "lunch";
  for (const dp of DAYPARTS) {
    if (dp.start <= dp.end) {
      if (h >= dp.start && h < dp.end) return dp.id;
    } else if (h >= dp.start || h < dp.end) {
      return dp.id;
    }
  }
  return "dinner";
}

export function buildTimeShiftIntelligence({ biData, salesItems = [] }) {
  const hourlyMenu = (biData?.by_hour || []).map((row) => {
    const gran = row.granularity || parseHourBucket(row.hour).granularity;
    const parsed = parseHourBucket(row.hour, gran);
    const h = parsed.hour ?? (row.hour != null ? hourInRiyadh(row.hour) : null);
    const label = formatHourBucketLabel(row.hour ?? row.business_day_key, gran);
    return {
      hour: h ?? 0,
      label,
      menuEvents: Number(row.count) || 0,
      daypart: hourToDaypart(h),
    };
  });

  const hourlySales = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${hour}:00`,
    salesQty: 0,
    salesRevenue: 0,
    modifierQty: 0,
  }));

  const daypartMap = {};
  DAYPARTS.forEach((dp) => {
    daypartMap[dp.id] = { id: dp.id, label: dp.label, menuEvents: 0, salesQty: 0, revenue: 0 };
  });

  const weekdayWeekend = {
    weekday: { menuEvents: 0, salesQty: 0, revenue: 0 },
    weekend: { menuEvents: 0, salesQty: 0, revenue: 0 },
  };

  (salesItems || []).forEach((row) => {
    const h = hourInRiyadh(row.sold_at || row.created_at);
    if (h == null) return;
    const qty = Number(row.quantity_sold) || 0;
    const rev = Number(row.net_sales) || 0;
    const isMod =
      row.is_modifier ||
      row.track_as_modifier ||
      ["modifier", "sauce_condiment", "addon"].includes(row.semantic_class);

    hourlySales[h].salesQty += qty;
    hourlySales[h].salesRevenue += rev;
    if (isMod) hourlySales[h].modifierQty += qty;

    const dp = hourToDaypart(h);
    if (daypartMap[dp]) {
      daypartMap[dp].salesQty += qty;
      daypartMap[dp].revenue += rev;
    }

    const wd = weekdayInRiyadh(row.sold_at || row.created_at);
    weekdayWeekend[wd].salesQty += qty;
    weekdayWeekend[wd].revenue += rev;
  });

  hourlyMenu.forEach((row) => {
    const dp = row.daypart;
    if (daypartMap[dp]) daypartMap[dp].menuEvents += row.menuEvents;
    weekdayWeekend.weekday.menuEvents += row.menuEvents * 0.7;
    weekdayWeekend.weekend.menuEvents += row.menuEvents * 0.3;
  });

  const conversionByHour = hourlyMenu.map((m, i) => {
    const s = hourlySales[m.hour] || hourlySales[i];
    const conv = m.menuEvents > 0 ? Math.round(((s?.salesQty || 0) / m.menuEvents) * 100) : 0;
    return {
      hour: m.hour,
      label: m.label,
      menuEvents: m.menuEvents,
      salesQty: s?.salesQty || 0,
      conversion: Math.min(conv, 100),
    };
  });

  const peakHour = [...hourlyMenu].sort((a, b) => b.menuEvents - a.menuEvents)[0];
  const peakDaypart = Object.values(daypartMap).sort((a, b) => b.revenue - a.revenue)[0];

  return {
    hourlyMenu,
    hourlySales: hourlySales.filter((h) => h.salesQty > 0 || h.hour % 3 === 0),
    conversionByHour,
    dayparts: Object.values(daypartMap),
    weekdayWeekend,
    peakHour,
    peakDaypart,
  };
}
