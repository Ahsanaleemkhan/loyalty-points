/**
 * Shared UI component library for the Loyalty Points admin.
 * Import from here instead of writing inline styles on every page.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { Form, Link, useLocation, useSearchParams } from "react-router";

// ── Badge ────────────────────────────────────────────────────────────────────

const BADGE_MAP: Record<string, string> = {
  EARNED_ONLINE:   "lp-badge-green",
  EARNED_PHYSICAL: "lp-badge-blue",
  EARNED_RULE:     "lp-badge-purple",
  MANUAL_ADJUST:   "lp-badge-purple",
  REDEEMED:        "lp-badge-amber",
  EXPIRED:         "lp-badge-gray",
  ACTIVE:          "lp-badge-green",
  USED:            "lp-badge-gray",
  PENDING:         "lp-badge-amber",
  APPROVED:        "lp-badge-green",
  REJECTED:        "lp-badge-red",
  CONVERTED:       "lp-badge-green",
};

const TX_LABEL: Record<string, string> = {
  EARNED_ONLINE:   "Online Purchase",
  EARNED_PHYSICAL: "Physical Receipt",
  EARNED_RULE:     "Bonus Points",
  MANUAL_ADJUST:   "Manual Adjust",
  REDEEMED:        "Redeemed",
  EXPIRED:         "Expired",
};

export function Badge({ type, label }: { type: string; label?: string }) {
  const cls = BADGE_MAP[type] ?? "lp-badge-gray";
  const text = label ?? TX_LABEL[type] ?? type;
  return <span className={`lp-badge ${cls}`}>{text}</span>;
}

// ── StatCard ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number | string;
  color?: string;
  delta?: { value: string; direction: "up" | "down" };
  icon?: string;
  animate?: boolean;
}

export function StatCard({ label, value, color = "#008060", delta, icon, animate = true }: StatCardProps) {
  const [displayed, setDisplayed] = useState<number | string>(
    animate && typeof value === "number" ? 0 : value
  );
  const startedRef = useRef(false);

  useEffect(() => {
    if (!animate || typeof value !== "number" || startedRef.current) return;
    startedRef.current = true;
    const duration = 800;
    const start = performance.now();
    const from = 0;
    const to = value;
    function step(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out-cubic
      setDisplayed(Math.round(from + (to - from) * eased));
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [value, animate]);

  const displayVal = animate && typeof value === "number"
    ? (displayed as number).toLocaleString()
    : typeof value === "number" ? value.toLocaleString() : value;

  return (
    <div className="lp-stat-card" style={{ "--accent": color } as React.CSSProperties}>
      {icon && <div style={{ fontSize: "24px", marginBottom: "8px", opacity: .7 }}>{icon}</div>}
      <div className="lp-stat-value">{displayVal}</div>
      <div className="lp-stat-label">{label}</div>
      {delta && (
        <div className={`lp-stat-delta ${delta.direction}`}>
          {delta.direction === "up" ? "↑" : "↓"} {delta.value}
        </div>
      )}
    </div>
  );
}

// ── EmptyState ───────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

export function EmptyState({ icon = "📭", title, subtitle, action }: EmptyStateProps) {
  return (
    <div className="lp-empty">
      <div className="lp-empty-icon">{icon}</div>
      <div className="lp-empty-title">{title}</div>
      {subtitle && <p className="lp-empty-sub">{subtitle}</p>}
      {action && (
        action.href
          ? <a href={action.href} className="lp-btn lp-btn-primary" style={{ display: "inline-flex" }}>{action.label}</a>
          : <button onClick={action.onClick} className="lp-btn lp-btn-primary">{action.label}</button>
      )}
    </div>
  );
}

// ── CopyButton ───────────────────────────────────────────────────────────────

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button onClick={copy} className={`lp-copy-btn${copied ? " copied" : ""}`} type="button" title="Copy to clipboard">
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

export function CodeWithCopy({ code }: { code: string }) {
  return (
    <span className="lp-code-wrap">
      <code className="lp-code">{code}</code>
      <CopyButton text={code} />
    </span>
  );
}

// ── Pagination ───────────────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}

export function Pagination({ page, totalPages, total, pageSize }: PaginationProps) {
  const [, setSearchParams] = useSearchParams();
  if (totalPages <= 1) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="lp-pagination">
      <span className="lp-pagination-info">Showing {start}–{end} of {total}</span>
      <div className="lp-pagination-btns">
        <button
          className="lp-btn lp-btn-secondary lp-btn-sm"
          disabled={page <= 1}
          onClick={() => setSearchParams((p) => { p.set("page", String(page - 1)); return p; })}
        >← Prev</button>
        <span style={{ display: "flex", alignItems: "center", padding: "0 10px", fontSize: "13px", color: "var(--lp-text-muted)" }}>
          {page} / {totalPages}
        </span>
        <button
          className="lp-btn lp-btn-secondary lp-btn-sm"
          disabled={page >= totalPages}
          onClick={() => setSearchParams((p) => { p.set("page", String(page + 1)); return p; })}
        >Next →</button>
      </div>
    </div>
  );
}

// ── SearchBar ────────────────────────────────────────────────────────────────

interface SearchBarProps {
  defaultValue?: string;
  placeholder?: string;
  extraFilters?: React.ReactNode;
}

export function SearchBar({ defaultValue = "", placeholder = "Search…", extraFilters }: SearchBarProps) {
  const [, setSearchParams] = useSearchParams();
  return (
    <Form method="get" className="lp-search-wrap">
      <div className="lp-search-input-wrap">
        <svg className="lp-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
        </svg>
        <input name="q" defaultValue={defaultValue} placeholder={placeholder} className="lp-input" />
      </div>
      {extraFilters}
      <input type="hidden" name="page" value="1" />
      <button type="submit" className="lp-btn lp-btn-primary lp-btn-sm">Search</button>
      {defaultValue && (
        <button type="button" className="lp-btn lp-btn-secondary lp-btn-sm" onClick={() => setSearchParams({})}>Clear</button>
      )}
    </Form>
  );
}

// ── Toast ────────────────────────────────────────────────────────────────────

export interface ToastItem {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastProps {
  toasts: ToastItem[];
  dismiss: (id: string) => void;
}

export function ToastContainer({ toasts, dismiss }: ToastProps) {
  return (
    <div className="lp-toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`lp-toast lp-toast-${t.type}`}>
          <span>{t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}</span>
          <span>{t.message}</span>
          <button className="lp-toast-dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, type: ToastItem["type"] = "success") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => dismiss(id), 4000);
  }, []); // eslint-disable-line

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, show, dismiss, ToastContainer };
}

// ── ProgressBar ──────────────────────────────────────────────────────────────

export function ProgressBar({ value, max, color = "var(--lp-green)" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="lp-progress-wrap">
      <div className="lp-progress-bar" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// ── HealthScore ──────────────────────────────────────────────────────────────

export function HealthScore({ score }: { score: number }) {
  const color = score >= 70 ? "#008060" : score >= 40 ? "#d97706" : "#dc2626";
  const label = score >= 70 ? "Great" : score >= 40 ? "Fair" : "Needs Attention";
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
        <span style={{ fontSize: "13px", fontWeight: "600", color: "var(--lp-text-muted)" }}>Program Health</span>
        <span style={{ fontSize: "22px", fontWeight: "800", color }}>{score}<span style={{ fontSize: "13px", fontWeight: "500", color: "var(--lp-text-muted)" }}>/100</span></span>
      </div>
      <div className="lp-health-bar-wrap">
        <div className="lp-health-bar" style={{ width: `${score}%`, background: color }} />
      </div>
      <div style={{ fontSize: "12px", color, fontWeight: "600", marginTop: "4px" }}>{label}</div>
    </div>
  );
}

// ── PageTabs ─────────────────────────────────────────────────────────────────

interface PageTab {
  label: string;
  to: string;
}

export function PageTabs({ tabs }: { tabs: PageTab[] }) {
  const { pathname } = useLocation();
  return (
    <div className="lp-page-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          className={`lp-page-tab${pathname === tab.to ? " lp-page-tab-active" : ""}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

// ── CSV Export ───────────────────────────────────────────────────────────────

export function exportCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const escape = (v: string | number) => {
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.map(escape).join(","),
    ...rows.map((r) => r.map(escape).join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
