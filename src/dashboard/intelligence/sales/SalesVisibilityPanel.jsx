import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Eye, ShoppingCart, TrendingUp } from "lucide-react";
import { buildConversionRows, getConversionOpportunities } from "../../utils/foodicsConversion";
import { formatExecutiveConversion } from "../../utils/intelligenceSanity";
import { hasVisibilityTracking } from "../../utils/intelligenceSanity";

function OpportunityCard({ icon, title, rows }) {
  if (!rows?.length) return null;
  return (
    <motion.div className="fi-opp-card" whileHover={{ y: -2 }}>
      <div className="fi-opp-head">
        {icon}
        <h3>{title}</h3>
      </div>
      <ul>
        {rows.slice(0, 5).map((r) => (
          <li key={r.item_name}>
            <strong>{r.item_name}</strong>
            <span>
              {r.item_views ?? r.item_impressions ?? 0} views · {r.quantity_sold} sold ·{" "}
              {r.conversion_display || `${r.menu_conversion_pct ?? r.conversion_rate ?? 0}%`}
            </span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export default function SalesVisibilityPanel({ salesItems = [], topItems = [] }) {
  const conversionRows = useMemo(() => {
    if (!salesItems.length) return [];
    return buildConversionRows(salesItems, topItems, []);
  }, [salesItems, topItems]);

  const opportunities = useMemo(() => getConversionOpportunities(conversionRows), [conversionRows]);
  const visibilityReady = useMemo(() => hasVisibilityTracking(topItems, null), [topItems]);

  if (!salesItems.length) {
    return <p className="nac-empty-state">Upload operational sales to compare menu visibility with Foodics sales.</p>;
  }

  return (
    <div className="nac-sales-visibility">
      {!visibilityReady ? (
        <p className="fi-visibility-note">
          Collecting visibility signals — impression data will sharpen guest attention metrics.
        </p>
      ) : null}

      <div className="fi-opps">
        <OpportunityCard
          icon={<Eye size={16} />}
          title="High attention, low sales"
          rows={opportunities.highVisibilityLowOrders || opportunities.highClicksLowOrders}
        />
        <OpportunityCard
          icon={<ShoppingCart size={16} />}
          title="Strong sales, low visibility"
          rows={opportunities.highOrdersLowVisibility || opportunities.highOrdersLowClicks}
        />
        <OpportunityCard
          icon={<TrendingUp size={16} />}
          title="Visual sellers"
          rows={opportunities.visualSellers}
        />
        <OpportunityCard
          icon={<AlertTriangle size={16} />}
          title="Needs sales attention"
          rows={opportunities.worstConversion}
        />
      </div>

      <div className="nac-sales-table-wrap">
        <table className="fi-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Views</th>
              <th>Units sold</th>
              <th>Conv %</th>
              <th>Net sales</th>
            </tr>
          </thead>
          <tbody>
            {conversionRows.slice(0, 12).map((r) => (
              <tr key={r.item_name}>
                <td>{r.item_name}</td>
                <td>{r.item_views ?? r.item_impressions ?? 0}</td>
                <td>{r.quantity_sold}</td>
                <td>{formatExecutiveConversion(r)}</td>
                <td>{Number(r.net_sales || 0).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
