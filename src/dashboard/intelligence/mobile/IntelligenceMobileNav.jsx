import React from "react";
import { MessageSquare, LayoutDashboard, FolderOpen, Settings } from "lucide-react";
import { MOBILE_INTELLIGENCE_NAV } from "../../navigation";

const NAV_ICONS = {
  ask: MessageSquare,
  dashboards: LayoutDashboard,
  vault: FolderOpen,
  settings: Settings,
};

export default function IntelligenceMobileNav({ active, onChange }) {
  return (
    <nav
      className="nac-intelligence-mobile-nav"
      role="tablist"
      aria-label="Intelligence sections"
    >
      {MOBILE_INTELLIGENCE_NAV.map((item) => {
        const Icon = NAV_ICONS[item.id];
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`nac-intelligence-mobile-nav__item ${isActive ? "is-active" : ""}`}
            onClick={() => onChange(item.id)}
          >
            {Icon ? <Icon size={20} aria-hidden /> : null}
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
