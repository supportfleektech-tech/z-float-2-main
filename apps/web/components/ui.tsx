import React from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success" | "light";
type Size = "sm" | "md" | "lg";

const base =
  "focus-ring inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white hover:bg-primary-strong",
  secondary: "bg-white text-ink border border-borderline hover:bg-surface",
  ghost: "text-muted hover:bg-surface hover:text-ink",
  danger: "bg-danger text-white hover:opacity-90",
  success: "bg-success text-white hover:opacity-90",
  light: "bg-white text-primary hover:bg-surface",
};

const sizes: Record<Size, string> = {
  sm: "text-sm px-3 py-1.5",
  md: "text-sm px-4 py-2.5",
  lg: "text-base px-5 py-3",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}

export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-card border border-borderline bg-card shadow-sm ${className}`} {...props} />;
}

export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm placeholder:text-muted/60 ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`focus-ring w-full rounded-control border border-borderline bg-white px-3 py-2.5 text-sm ${className}`}
      {...props}
    />
  );
}

export function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-ink">
      {children}
    </label>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "success" | "warning" | "danger" | "info"; children: React.ReactNode }) {
  const tones = {
    neutral: "bg-surface text-muted border-borderline",
    success: "bg-success/10 text-success border-success/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    danger: "bg-danger/10 text-danger border-danger/20",
    info: "bg-primary/10 text-primary border-primary/20",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export const STATUS_TONES: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  DRAFT: "neutral",
  VALIDATING: "info",
  PENDING_APPROVAL: "warning",
  APPROVED: "info",
  REJECTED: "danger",
  QUEUED: "info",
  PROCESSING: "info",
  PROVIDER_PENDING: "warning",
  SUCCESS: "success",
  FAILED: "danger",
  REVERSED: "neutral",
  CANCELLED: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

export function StatCard({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "success" | "danger" | "warning" }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-tight ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : ""}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <Card className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-xl">◎</div>
      <h3 className="text-base font-semibold">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </Card>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-borderline ${className}`} />;
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-primary ${className}`} viewBox="0 0 24 24" fill="none" aria-label="Loading">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="focus-ring rounded p-1 text-muted hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function TableShell({ headers, children, empty }: { headers: string[]; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-borderline bg-surface/60 text-xs uppercase tracking-wide text-muted">
              {headers.map((h) => (
                <th key={h} className="px-4 py-3 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-borderline">{children}</tbody>
        </table>
      </div>
      {empty ? <div className="p-6">{empty}</div> : null}
    </Card>
  );
}

export function Switch({ label, disabled, className, id, onCheckedChange, ...props }: { label?: string; disabled?: boolean; className?: string; id?: string; onCheckedChange?: (checked: boolean) => void } & React.InputHTMLAttributes<HTMLInputElement>) {
    const switchId = id || `switch-${Math.random().toString(36).slice(2, 9)}`;
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onCheckedChange) onCheckedChange(e.target.checked);
      if (props.onChange) props.onChange(e);
    };
    return (
      <label className={`flex items-center gap-3 cursor-pointer ${className ?? ""} ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
        <span className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-borderline bg-surface transition-colors focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 peer">
          <input
            type="checkbox"
            id={switchId}
            className="sr-only peer"
            disabled={disabled}
            onChange={handleChange}
            {...props}
          />
          <span className="pointer-events-none absolute left-1 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-lg transition-transform peer-checked:translate-x-full peer-checked:border-primary peer-checked:bg-primary" aria-hidden="true" />
        </span>
        {label && <span className="text-sm font-medium text-ink">{label}</span>}
      </label>
    );
  }

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-5 flex gap-1 border-b border-borderline" role="tablist">
      {tabs.map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={active === t}
          onClick={() => onChange(t)}
          className={`focus-ring -mb-px border-b-2 px-4 py-2.5 text-sm font-medium ${
            active === t ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
