import React, { useEffect, useRef } from "react";
import {
  LayoutDashboard,
  FolderOpen,
  Settings,
  MessageSquarePlus,
  X,
} from "lucide-react";

const MORE_ITEMS = [
  { id: "dashboards", label: "Dashboards", icon: LayoutDashboard },
  { id: "vault", label: "Vault", icon: FolderOpen },
  { id: "settings", label: "Settings", icon: Settings },
];

export default function IntelligenceMobileMoreMenu({
  open = false,
  onClose,
  onSelect,
  showNewChat = false,
  onNewChat,
}) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="nac-intelligence-mobile-more" role="presentation">
      <button
        type="button"
        className="nac-intelligence-mobile-more__backdrop"
        aria-label="Close menu"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="nac-intelligence-mobile-more__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Intelligence sections"
      >
        <div className="nac-intelligence-mobile-more__head">
          <span>More</span>
          <button type="button" className="nac-intelligence-mobile-more__close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="nac-intelligence-mobile-more__items">
          {showNewChat ? (
            <button
              type="button"
              className="nac-intelligence-mobile-more__item"
              onClick={() => {
                onNewChat?.();
                onClose?.();
              }}
            >
              <MessageSquarePlus size={18} aria-hidden />
              <span>New chat</span>
            </button>
          ) : null}
          {MORE_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className="nac-intelligence-mobile-more__item"
                onClick={() => {
                  onSelect?.(item.id);
                  onClose?.();
                }}
              >
                {Icon ? <Icon size={18} aria-hidden /> : null}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
