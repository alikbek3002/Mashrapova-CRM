// Скелетоны загрузки: серые блоки с переливом вместо текста «Загрузка…».
import type { CSSProperties } from "react";

type SkProps = { w?: number | string; h?: number | string; r?: number | string; style?: CSSProperties; className?: string };

export const Sk = ({ w = "100%", h = 12, r, style, className }: SkProps) => (
  <span
    className={`sk${className ? ` ${className}` : ""}`}
    style={{ width: w, height: h, borderRadius: r, ...style }}
    aria-hidden="true"
  />
);

// Строка текста внутри заголовков и подписей.
export const SkeletonText = ({ w = 160, h = 12 }: { w?: number | string; h?: number }) => (
  <Sk w={w} h={h} style={{ display: "inline-block", verticalAlign: "middle" }} />
);

// Список / таблица: аватар, две строки текста, плашка статуса.
export const SkeletonRows = ({ rows = 6, avatar = true }: { rows?: number; avatar?: boolean }) => (
  <div className="sk-rows" role="status" aria-label="Загрузка" aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div className="sk-row" key={i} style={{ animationDelay: `${i * 60}ms` }}>
        {avatar && <Sk w={36} h={36} r={999} />}
        <div className="sk-row__text">
          <Sk w={`${62 - ((i * 13) % 26)}%`} h={12} />
          <Sk w={`${34 + ((i * 17) % 22)}%`} h={10} />
        </div>
        <Sk w={64} h={22} r={999} />
      </div>
    ))}
  </div>
);

// Плитки показателей (как KPI на дашборде).
export const SkeletonKpis = ({ count = 4 }: { count?: number }) => (
  <div className="sk-kpis" aria-hidden="true">
    {Array.from({ length: count }).map((_, i) => (
      <div className="sk-kpi" key={i}>
        <Sk w="55%" h={11} />
        <Sk w="40%" h={30} r={6} />
        <Sk w="65%" h={10} />
      </div>
    ))}
  </div>
);

// Целая страница: заголовок, показатели, карточка со списком.
// mobile — для приложений тренера и родителя.
export const SkeletonPage = ({ mobile = false }: { mobile?: boolean }) => (
  <div className={`sk-page${mobile ? " sk-page--mobile" : ""}`} role="status" aria-label="Загрузка" aria-busy="true">
    <div className="sk-page__head">
      <Sk w={mobile ? 140 : 220} h={mobile ? 24 : 32} r={6} />
      <Sk w={mobile ? 200 : 280} h={12} />
    </div>
    <SkeletonKpis count={mobile ? 2 : 4} />
    <div className="sk-card">
      <SkeletonRows rows={mobile ? 4 : 6} />
    </div>
  </div>
);
