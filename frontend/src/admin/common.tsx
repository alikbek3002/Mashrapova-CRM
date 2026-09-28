import type { ReactNode } from "react";
import { Icon } from "../data";

export const PageHeader = ({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) => (
  <div className="page-head">
    <div>
      <h1>{title}</h1>
      {subtitle && <div className="page-head__sub">{subtitle}</div>}
    </div>
    {actions && <div className="page-head__actions">{actions}</div>}
  </div>
);

export const SearchBox = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) => (
  <div className="search-box">
    <Icon name="search" size={14} />
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
  </div>
);

export const EmptyState = ({ title, hint }: { title: string; hint?: string }) => (
  <div className="empty">
    <div className="empty__title">{title}</div>
    {hint && <div>{hint}</div>}
  </div>
);

export const initialsOf = (fullName: string) =>
  fullName
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2);

export const formatCurrency = (n: number) => `${n.toLocaleString("ru-RU")} с`;
