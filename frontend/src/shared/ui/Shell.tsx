// MobileDesktopShell — общий layout для PWA-экранов (тренер/родитель).
// Desktop (≥ 960px): sidebar слева + контент справа.
// Mobile (< 960px): полноэкранный контент + bottom tabbar.
// Переключение через CSS @media — никакого window.innerWidth в JS.

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { MIcon } from "../../data";

export type ShellTab = {
  id: string;
  label: string;
  icon: string; // имя из Material Symbols (Google Icons)
};

const SHELL_COLLAPSED_KEY = "uq_shell_collapsed";

export const Shell = ({
  brand,
  user,
  tabs,
  active,
  onTab,
  topRight,
  children,
}: {
  brand: { title: string; subtitle?: string };
  user?: { name: string; subtitle?: string; avatar?: string };
  tabs: ShellTab[];
  active: string;
  onTab: (id: string) => void;
  topRight?: ReactNode;
  children: ReactNode;
}) => {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SHELL_COLLAPSED_KEY) === "1"; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(SHELL_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch {}
  }, [collapsed]);

  return (
    <div className={`app-shell ${collapsed ? "is-collapsed" : ""}`}>
      {/* Desktop sidebar */}
      <aside className="app-shell__sidebar">
        <button
          type="button"
          className="app-shell__toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          title={collapsed ? "Развернуть" : "Свернуть"}
        >
          <MIcon name={collapsed ? "menu" : "menu_open"} size={22} />
        </button>

        {!collapsed && (
          <div className="app-shell__brand">
            <div className="app-shell__brand-title">{brand.title}</div>
            {brand.subtitle && (
              <div className="app-shell__brand-sub">{brand.subtitle}</div>
            )}
          </div>
        )}

        {user && !collapsed && (
          <div className="app-shell__user">
            <div className="app-shell__user-av">
              {user.avatar && (user.avatar.startsWith("/") || user.avatar.startsWith("http")) ? (
                <img
                  src={user.avatar}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
                />
              ) : (
                (user.avatar ?? user.name).slice(0, 1).toUpperCase()
              )}
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="app-shell__user-name">{user.name}</div>
              {user.subtitle && (
                <div className="app-shell__user-sub">{user.subtitle}</div>
              )}
            </div>
          </div>
        )}

        <nav className="app-shell__nav">
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`app-shell__nav-item ${isActive ? "is-active" : ""}`}
                onClick={() => onTab(t.id)}
                title={collapsed ? t.label : undefined}
              >
                <span className="app-shell__nav-icon">
                  <MIcon name={t.icon} size={22} fill={isActive} weight={isActive ? 500 : 400} />
                </span>
                {!collapsed && <span className="app-shell__nav-label">{t.label}</span>}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content area — Mobile uses .m-screen layout, Desktop just renders children. */}
      <main className="app-shell__main">
        {topRight && <div className="app-shell__top-right">{topRight}</div>}
        {children}

        {/* Mobile bottom tabbar — hidden by CSS on desktop */}
        <div className="app-shell__tabbar">
          {tabs.map((t) => {
            const isActive = active === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={`app-shell__tabbar-btn ${isActive ? "is-active" : ""}`}
                onClick={() => onTab(t.id)}
              >
                <MIcon name={t.icon} size={22} fill={isActive} weight={isActive ? 500 : 400} />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
};
