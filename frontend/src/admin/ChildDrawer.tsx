// Universal child detail drawer — used by admin/coach/parent.
// Tabs hidden by role: parent sees no "Платежи"/"Комментарии"; coach sees no "Платежи"/"Комментарии".
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { Modal, Field } from "../shared/ui/Modal";
import { fmtD } from "../shared/lib/dates";
import { Icon } from "../data";
import type { Lang } from "../data";
import {
  useCardBalance, useCardsForChild, useCardBalancesForChild, useAttendanceForChild, usePaymentsForChild,
  useFreezes, useProgressNotes, useProfile, useChildPrimaryCoach,
  useChildEnrollments, useGroups, useChildActiveCards,
  useDepositBalance, useDepositHistory, useChildComments, useCoaches,
  useChildLessons, useCardLessonExclusions, useChildCardDebts,
} from "../shared/api/queries";
import {
  usePtPackages, usePtLessonsForChild, usePtCoachComments, usePtChangeCoach,
} from "../shared/api/pt";
import {
  useAddProgressNote, useCreateFreeze, useExtendCard, useCancelCard, useCloseCard, useAddCardLessons, useEndFreeze,
  useRemoveCardLessons, useRestoreCardLessons,
  useAddEnrollment, useRemoveEnrollment, useAddChildComment,
  useMarkAttendance,
} from "../shared/api/mutations";
import { useAuth } from "../shared/auth/AuthProvider";
import { can, usePerm } from "../shared/auth/rbac";
import type { ChildWithFamily } from "../shared/api/queries";
import { supabase } from "../shared/api/supabase";
import { computeWindowEnd } from "../shared/lib/enrollmentWindow";
import { EditableChildAvatar } from "../shared/ui/ChildAvatar";
import { resolveStorageUrl } from "../shared/api/avatar";
import { initialsOf, formatCurrency } from "./common";
import { AddChildModal, SellCardModal, TopUpDepositModal, WithdrawDepositModal, AcceptPaymentModal } from "../shared/ui/forms";
import { freezeOutcome, type CardType, type AttendanceStatus, type PaymentMethod } from "../shared/types/database";

type Role = "admin" | "coach" | "parent";
type TabId = "subs" | "att" | "pay" | "deposit" | "freezes" | "notes" | "comments" | "group" | "pt";

const STATUS_LABEL: Record<string, { ru: string; ky: string }> = {
  active: { ru: "активен", ky: "активдүү" },
  frozen: { ru: "заморожен", ky: "тындырылган" },
  expired: { ru: "абонемент истёк", ky: "абонемент бүттү" },
  debtor: { ru: "должник", ky: "карызкор" },
  archived: { ru: "в архиве", ky: "архивде" },
};

const CARD_TYPE_LABEL: Record<string, { ru: string; ky: string }> = {
  monthly: { ru: "Месячный", ky: "Айлык" },
  quarterly: { ru: "3 месяца", ky: "3 ай" },
  half_year: { ru: "6 месяцев", ky: "6 ай" },
  nine_month: { ru: "9 месяцев", ky: "9 ай" },
  annual: { ru: "12 месяцев", ky: "12 ай" },
  personal: { ru: "Персональный", ky: "Жеке" },
  single: { ru: "Разовое занятие", ky: "Бир жолку сабак" },
  trial: { ru: "Пробная тренировка", ky: "Сыноо машыгуусу" },
};

const CARD_STATUS_LABEL: Record<string, { ru: string; ky: string }> = {
  active: { ru: "активен", ky: "активдүү" },
  ending: { ru: "заканчивается", ky: "бүтүп жатат" },
  frozen: { ru: "заморожен", ky: "тындырылган" },
  expired: { ru: "истёк", ky: "бүттү" },
  debt: { ru: "долг", ky: "карыз" },
  archived: { ru: "в архиве", ky: "архивде" },
};

const SOURCE_LABEL: Record<"target" | "referral" | "other", { ru: string; ky: string }> = {
  target: { ru: "таргет (Instagram)", ky: "таргет (Instagram)" },
  referral: { ru: "рекомендация", ky: "сунуштама" },
  other: { ru: "другое", ky: "башка" },
};

const ageFromDob = (dob: string): number => {
  const d = new Date(dob); const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) a--;
  return Math.max(0, a);
};

export const ChildDrawer = ({
  childId, child, open, onClose, lang,
}: {
  childId: string;
  child?: ChildWithFamily;
  open: boolean;
  onClose: () => void;
  lang: Lang;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { user } = useAuth();
  const role: Role = (user?.role === "coach" ? "coach" : user?.role === "parent" ? "parent" : "admin");
  const { data: manager } = useProfile(child?.responsible_manager_id ?? null);
  const { data: primaryCoach } = useChildPrimaryCoach(childId);
  // Полная карточка: учётка родителя и активные группы прямо в шапке.
  const { data: parentAccount } = useProfile((child?.family as any)?.parent_user_id ?? null);
  const activeEnrollments = ((child as any)?.enrollments ?? []).filter((e: any) => e.archived_at == null);
  const activeGroupNames = activeEnrollments
    .filter((e: any) => e.group?.name)
    .map((e: any) => e.group.name as string);
  // Дисциплины (ТЗ §3.2) — секции активных групп, без повторов.
  const activeSectionNames = Array.from(new Set<string>(
    activeEnrollments
      .map((e: any) => e.group?.section?.[lang === "ru" ? "name_ru" : "name_ky"] as string | undefined)
      .filter(Boolean) as string[],
  ));

  const tabs: { id: TabId; ru: string; ky: string; allow: Role[] }[] = [
    { id: "subs",     ru: "Абонементы", ky: "Абонементтер", allow: ["admin", "coach", "parent"] },
    { id: "att",      ru: "Посещения",  ky: "Катышуу",      allow: ["admin", "coach", "parent"] },
    { id: "pt",       ru: "Перс. тренировки", ky: "Жеке машыгуу", allow: ["admin", "coach", "parent"] },
    { id: "group",    ru: "Группа",     ky: "Топ",          allow: ["admin"] },
    { id: "pay",      ru: "Платежи",    ky: "Төлөмдөр",     allow: ["admin", "parent"] },
    { id: "deposit",  ru: "Депозит",    ky: "Депозит",      allow: ["admin", "parent"] },
    { id: "freezes",  ru: "Заморозки",  ky: "Тындыруулар",  allow: ["admin", "coach", "parent"] },
    { id: "notes",    ru: "Прогресс",   ky: "Прогресс",     allow: ["admin", "coach", "parent"] },
    { id: "comments", ru: "Комментарии", ky: "Комментарий",  allow: ["admin", "coach"] },
  ];
  const visible = tabs.filter((tab) => tab.allow.includes(role));
  const [tab, setTab] = useState<TabId>("subs");
  const [editOpen, setEditOpen] = useState(false);
  // Долг по абонементам — красная полоса над вкладками (просьба офиса 2026-09-10).
  const debts = useChildCardDebts(childId);
  const [payDebtCard, setPayDebtCard] = useState<{ id: string; debt: number; type: string } | null>(null);

  return (
    <Modal open={open} onClose={onClose} title={child?.full_name ?? t("Карточка ребёнка", "Бала картасы")} width={760}>
      {child && (
        <div className="child-hero">
          <EditableChildAvatar
            className="child-hero__av"
            childId={child.id}
            photoPath={child.photo_path}
            fullName={child.full_name}
            canEdit={role === "admin" || role === "parent"}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="child-hero__name">{child.full_name}</div>
            <div className="child-hero__meta">
              {ageFromDob(child.birth_date)} {t("лет", "жаш")} ({fmtD(child.birth_date)}) · {t("карта", "карта")} {child.card_number ?? "—"} · <span className={`pill pill--${child.status}`}>{STATUS_LABEL[child.status]?.[lang] ?? child.status}</span>
            </div>
            {child.family && (
              <div className="child-hero__family">
                {child.family.father_name && (
                  <span>
                    👨 {child.family.father_name}{" "}
                    {child.family.father_phone && (
                      <>
                        <a href={`tel:${child.family.father_phone}`} style={{ color: "var(--blue)", marginLeft: 4 }}>{child.family.father_phone}</a>
                        <a href={`https://wa.me/${child.family.father_phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="icon-btn" style={{ width: 24, height: 24, marginLeft: 4, display: "inline-flex" }} title="WhatsApp">
                          <Icon name="whatsapp" size={12} />
                        </a>
                      </>
                    )}
                  </span>
                )}
                {child.family.mother_name && (
                  <span>
                    👩 {child.family.mother_name}{" "}
                    {child.family.mother_phone && (
                      <>
                        <a href={`tel:${child.family.mother_phone}`} style={{ color: "var(--blue)", marginLeft: 4 }}>{child.family.mother_phone}</a>
                        <a href={`https://wa.me/${child.family.mother_phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noreferrer" className="icon-btn" style={{ width: 24, height: 24, marginLeft: 4, display: "inline-flex" }} title="WhatsApp">
                          <Icon name="whatsapp" size={12} />
                        </a>
                      </>
                    )}
                  </span>
                )}
              </div>
            )}
            <div className="child-hero__family" style={{ marginTop: 6 }}>
              <span>
                🗓 {t("В академии с", "Академияда")}: <b>{fmtD(child.created_at)}</b>
              </span>
              <span>
                📣 {t("Источник", "Булагы")}:{" "}
                {child.source
                  ? <b>{SOURCE_LABEL[child.source][lang]}</b>
                  : <span style={{ color: "var(--muted)" }}>{t("не указан", "көрсөтүлгөн эмес")}</span>}
              </span>
            </div>
            <div className="child-hero__family" style={{ marginTop: 6 }}>
              <span>
                🥊 {t("Дисциплины", "Багыттар")}:{" "}
                {activeSectionNames.length > 0
                  ? <b>{activeSectionNames.join(", ")}</b>
                  : <span style={{ color: "var(--muted)" }}>{t("пока нет", "азырынча жок")}</span>}
              </span>
            </div>
            <div className="child-hero__family" style={{ marginTop: 6 }}>
              <span>
                👥 {t("Группы", "Топтор")}:{" "}
                {activeGroupNames.length > 0
                  ? <b>{activeGroupNames.join(", ")}</b>
                  : <span style={{ color: "var(--muted)" }}>{t("не в группе", "топто эмес")}</span>}
              </span>
              {role === "admin" && (
                <span>
                  👤 {t("Вход родителя в приложение", "Ата-эненин тиркемеге кирүүсү")}:{" "}
                  {parentAccount ? (
                    <>
                      <b>{parentAccount.full_name}</b>
                      {parentAccount.phone && (
                        <a href={`tel:${parentAccount.phone}`} style={{ color: "var(--blue)", marginLeft: 6 }}>{parentAccount.phone}</a>
                      )}
                      {parentAccount.email && (
                        <span style={{ color: "var(--muted)", marginLeft: 6 }}>{parentAccount.email}</span>
                      )}
                    </>
                  ) : (
                    <span style={{ color: "var(--muted)" }}>{t("ещё не выдан", "азырынча берилген эмес")}</span>
                  )}
                </span>
              )}
            </div>
            <div className="child-hero__family" style={{ marginTop: 6 }}>
              <span>
                🧑‍💼 {t("Менеджер", "Менеджер")}:{" "}
                {manager ? (
                  <>
                    <b>{manager.full_name}</b>
                    {manager.phone && (
                      <a href={`tel:${manager.phone}`} style={{ color: "var(--blue)", marginLeft: 6 }}>{manager.phone}</a>
                    )}
                  </>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </span>
              <span>
                🏃 {t("Тренер", "Тренер")}:{" "}
                {primaryCoach ? (
                  <>
                    <b>{primaryCoach.full_name}</b>
                    {primaryCoach.phone && (
                      <a href={`tel:${primaryCoach.phone}`} style={{ color: "var(--blue)", marginLeft: 6 }}>{primaryCoach.phone}</a>
                    )}
                  </>
                ) : (
                  <span style={{ color: "var(--muted)" }}>—</span>
                )}
              </span>
            </div>
            {child.family?.comment && role !== "parent" && (
              <div className="child-hero__family" style={{ marginTop: 6 }}>
                <span>💬 {t("Комментарий к семье", "Үй-бүлөгө комментарий")}: <b style={{ fontWeight: 500 }}>{child.family.comment}</b></span>
              </div>
            )}
          </div>
          {role === "admin" && (
            <button className="btn" style={{ height: 32 }} onClick={() => setEditOpen(true)}>
              <Icon name="settings" size={14} /> {t("Изменить", "Өзгөртүү")}
            </button>
          )}
        </div>
      )}

      {child && editOpen && (
        <AddChildModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          lang={lang}
          initial={{
            id: child.id,
            family_id: child.family_id,
            full_name: child.full_name,
            birth_date: child.birth_date,
            card_number: child.card_number,
            responsible_manager_id: child.responsible_manager_id,
            amo_url: (child as any).amo_url ?? null,
            source: child.source ?? null,
            referred_by_child_id: child.referred_by_child_id ?? null,
          }}
        />
      )}

      {debts.total > 0 && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          margin: "0 0 8px", padding: "8px 12px",
          background: "var(--red-50)", border: "1px solid var(--red-100)", borderRadius: "var(--r-sm)",
          fontSize: 13,
        }}>
          <span style={{ color: "var(--red-600)", fontWeight: 700 }}>
            {t("Долг", "Карыз")}: {formatCurrency(debts.total)}
          </span>
          <span style={{ color: "var(--muted)", fontSize: 12 }}>
            {debts.data.map((d) => `${d.type} ${fmtD(d.start_date)}: ${formatCurrency(d.debt)}`).join(" · ")}
          </span>
          {role === "admin" && can(user?.role, "receive_payment") && (
            <button
              className="btn btn--primary"
              style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
              onClick={() => { const d = debts.data[0]; if (d) setPayDebtCard({ id: d.card_id, debt: d.debt, type: d.type }); }}
            >
              {t("Погасить", "Төлөө")}
            </button>
          )}
        </div>
      )}
      {payDebtCard && (
        <AcceptPaymentModal
          open={!!payDebtCard}
          onClose={() => setPayDebtCard(null)}
          lang={lang}
          presetChildId={childId}
          presetCardId={payDebtCard.id}
          presetAmount={payDebtCard.debt}
          presetComment={t(`Погашение долга по абонементу ${payDebtCard.type}`, `${payDebtCard.type} абонементи боюнча карызды төлөө`)}
        />
      )}

      <div className="drawer-tabs">
        {visible.map((tt) => (
          <button key={tt.id} className={`drawer-tab ${tab === tt.id ? "is-active" : ""}`} onClick={() => setTab(tt.id)}>
            {lang === "ru" ? tt.ru : tt.ky}
          </button>
        ))}
      </div>

      <div className="drawer-body">
        {tab === "subs" && <SubsTab childId={childId} lang={lang} />}
        {tab === "att" && <AttTab childId={childId} lang={lang} />}
        {tab === "group" && <GroupTab childId={childId} childName={child?.full_name ?? ""} lang={lang} />}
        {tab === "pay" && <PayTab childId={childId} lang={lang} />}
        {tab === "deposit" && <DepositTab childId={childId} role={role} lang={lang} />}
        {tab === "freezes" && <FreezesTab childId={childId} role={role} lang={lang} />}
        {tab === "notes" && <NotesTab childId={childId} role={role} userId={user?.id ?? ""} lang={lang} />}
        {tab === "comments" && <CommentsTab childId={childId} lang={lang} viewerRole={role} />}
        {tab === "pt" && <PtTab childId={childId} role={role} lang={lang} />}
      </div>
    </Modal>
  );
};

// ============================ Subs ============================
const SubsTab = ({ childId, lang }: { childId: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { user } = useAuth();
  // Cards CRUD on the child drawer is allowed for office roles that sell cards.
  const isAdminLike = can(user?.role, "sell_cards");
  // По ТЗ §3.2 активных абонементов может быть несколько — по одному на секцию.
  const { data: allBalances = [] } = useCardBalancesForChild(childId);
  const activeBalances = allBalances.filter((b) => b.status === "active" || b.status === "ending");
  const { data: myCards = [] } = useCardsForChild(childId);
  const debts = useChildCardDebts(childId);
  const debtOf = (cardId: string) => debts.data.find((d) => d.card_id === cardId)?.debt ?? 0;
  const [payCard, setPayCard] = useState<{ id: string; debt: number; type: string } | null>(null);

  const extend = useExtendCard();
  const cancelCard = useCancelCard();
  const closeCard = useCloseCard();
  const [sellOpen, setSellOpen] = useState(false);
  // «+ занятия»: карта, к которой добавляем.
  const [addLessonsCard, setAddLessonsCard] = useState<{ id: string; type: string; total_lessons: number | null; end_date: string } | null>(null);
  // «Удалить тренировки»: карта, с которой снимаем (старший менеджер и выше).
  const canRemoveLessons = can(user?.role, "remove_card_lessons");
  const [removeLessonsCard, setRemoveLessonsCard] = useState<{ id: string; type: string; total_lessons: number | null; start_date: string; end_date: string; section_id: string | null } | null>(null);
  // Есть ли вообще активный или ending абонемент — для пустого состояния.
  const hasActive = myCards.some((c) => c.status === "active" || c.status === "ending");
  // Карта для баннера сверху: истекающая — всегда; истёкшая — только если
  // действующей нет. Раньше после продажи нового абонемента старый expired
  // всё равно рисовал красное «истёк, продайте новый» рядом с «36 из 36»
  // (скриншот офиса 2026-09-02).
  const expiredCard = myCards.find((c) => c.status === "ending")
    ?? (hasActive ? undefined : myCards.find((c) => c.status === "expired"));
  // Оплаченный вперёд период (предоплатное продление): карта с будущим
  // стартом. Пока она есть — кнопку «продлить» не показываем.
  const todayIso = new Date().toISOString().slice(0, 10);
  const successorCard = myCards.find(
    (c) => (c.status === "active" || c.status === "ending") && c.start_date > todayIso,
  );

  const handleExtend = (cardId: string, currentEnd: string) => {
    const raw = prompt(
      t("Новая дата окончания (ДД.ММ.ГГГГ)", "Жаңы аяктоо күнү (КК.АА.ЖЖЖЖ)"),
      fmtD(currentEnd),
    );
    if (!raw) return;
    // Принимаем и ДД.ММ.ГГГГ, и ГГГГ-ММ-ДД.
    const dm = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.trim());
    const next = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : raw.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(next)) {
      alert(t("Дата не распознана. Формат: ДД.ММ.ГГГГ", "Күн таанылган жок. Формат: КК.АА.ЖЖЖЖ"));
      return;
    }
    extend.mutate({ card_id: cardId, new_end_date: next });
  };
  const handleCancel = (cardId: string) => {
    const reason = prompt(t("Причина отмены абонемента?", "Жокко чыгаруу себеби?"));
    if (!reason) return;
    if (!confirm(t("Точно отменить? Абонемент уйдёт в архив и пропадёт из табелей.", "Чындап жокко чыгарасызбы?"))) return;
    cancelCard.mutate({ card_id: cardId, reason });
  };
  // Закрыть досрочно = заблокировать с сохранением истории: карта остаётся
  // в списке, посещения и пропуски видны, дальше по ней не отмечают. После
  // этого можно продать новый абонемент — с другой группой или временем.
  const handleClose = (cardId: string) => {
    const reason = prompt(t(
      "Причина закрытия абонемента? (история посещений сохранится, остаток зафиксируется)",
      "Абонементти жабуу себеби? (катышуу тарыхы сакталат)",
    ));
    if (!reason) return;
    if (!confirm(t("Закрыть абонемент сегодняшним числом?", "Абонементти бүгүнкү күн менен жабабызбы?"))) return;
    closeCard.mutate({ card_id: cardId, reason });
  };

  return (
    <>
      {/* Кнопка продажи нового абонемента — всегда видна для admin-like ролей */}
      {isAdminLike && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn btn--primary"
            style={{ padding: "8px 14px", fontSize: 13 }}
            onClick={() => setSellOpen(true)}
          >
            <Icon name="plus" size={14} /> {t("Продать абонемент", "Абонемент сатуу")}
          </button>
        </div>
      )}

      {activeBalances.map((b) => {
        const total = b.total_lessons ?? 0;
        const left = b.remaining ?? 0;
        const pct = total ? (left / total) * 100 : 0;
        const sec = (myCards.find((c) => c.id === b.club_card_id) as any)?.section as { name_ru?: string; name_ky?: string } | null | undefined;
        return (
          <div className="balance-card" key={b.club_card_id} style={{ marginBottom: 10 }}>
            <div className="balance-card__head">
              <div>
                <div className="balance-card__lbl">
                  {CARD_TYPE_LABEL[b.type]?.[lang] ?? b.type}
                  {sec && ` · ${lang === "ru" ? sec.name_ru : sec.name_ky}`}
                  {` · ${fmtD(b.start_date)} → ${fmtD(b.end_date)}`}
                </div>
                <div className="balance-card__val">{left}<small>{t("из", "ичинен")} {total}</small></div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "var(--muted)" }}>
                {t("Заморозок", "Тындыруу")}: <b style={{ color: "var(--ink)" }}>{b.approved_freezes}</b>
              </div>
            </div>
            <div className="kid-hero__bar"><div className="kid-hero__bar-fill" style={{ width: `${pct}%` }} /></div>
          </div>
        );
      })}

      {/* Пустое состояние: ни одной активной карты — призываем продать */}
      {isAdminLike && !hasActive && !expiredCard && myCards.length === 0 && (
        <div style={{
          padding: 20, textAlign: "center",
          background: "var(--bg-soft)", border: "1px dashed var(--line)",
          borderRadius: "var(--r-sm)",
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
            {t("Нет активного абонемента", "Активдүү абонемент жок")}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12 }}>
            {t(
              "Продайте абонемент, чтобы записать ребёнка в группу.",
              "Балaны топко жазуу үчүн абонемент сатыңыз.",
            )}
          </div>
          <button
            className="btn btn--primary"
            onClick={() => setSellOpen(true)}
          >
            <Icon name="plus" size={14} /> {t("Продать абонемент", "Абонемент сатуу")}
          </button>
        </div>
      )}

      {/* Оплачено вперёд — продление уже сделано, следующий период ждёт */}
      {isAdminLike && successorCard && (
        <div style={{
          marginTop: 12, padding: "10px 14px",
          background: "var(--green-50, oklch(0.96 0.05 150))",
          border: "1px solid oklch(0.88 0.08 150)",
          borderRadius: "var(--r-sm)",
          display: "flex", alignItems: "center", gap: 10, fontSize: 13,
        }}>
          <Icon name="check" size={16} />
          <div style={{ flex: 1 }}>
            {t(
              `Оплачено вперёд: следующий период ${fmtD(successorCard.start_date)} → ${fmtD(successorCard.end_date)}.`,
              `Алдын ала төлөнгөн: кийинки мезгил ${fmtD(successorCard.start_date)} → ${fmtD(successorCard.end_date)}.`,
            )}
          </div>
        </div>
      )}

      {/* Баннер "истёк/истекает". Кнопка продления убрана — только продажа
          нового абонемента (менеджер сам выбирает вид/количество/цену). */}
      {isAdminLike && expiredCard && !successorCard && (
        <div style={{
          marginTop: 12, padding: "10px 14px",
          background: expiredCard.status === "expired" ? "var(--red-50)" : "var(--yellow-100)",
          border: `1px solid ${expiredCard.status === "expired" ? "var(--red-100)" : "oklch(0.92 0.10 90)"}`,
          borderRadius: "var(--r-sm)",
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <Icon name="warn" size={16} />
          <div style={{ flex: 1, fontSize: 13 }}>
            {expiredCard.status === "expired"
              ? t(`Абонемент истёк ${fmtD(expiredCard.end_date)}. Продайте новый — с нужным числом занятий.`, `Абонемент бүтүп калды (${fmtD(expiredCard.end_date)}). Жаңысын сатыңыз.`)
              : t(`Абонемент истекает ${fmtD(expiredCard.end_date)}. Можно продать новый.`, `Абонемент бүтүүгө жакын.`)}
          </div>
          <button
            className="btn btn--primary"
            style={{ padding: "6px 12px", fontSize: 12 }}
            onClick={() => setSellOpen(true)}
          >
            <Icon name="plus" size={12} stroke={2.5} /> {t("Продать абонемент", "Абонемент сатуу")}
          </button>
        </div>
      )}

      <SellCardModal
        open={sellOpen}
        onClose={() => setSellOpen(false)}
        lang={lang}
        presetChildId={childId}
      />

      <div className="m-sect" style={{ paddingTop: 12 }}>
        <span className="m-sect__title">{t("История", "Тарых")}</span>
      </div>
      {myCards.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Абонементов не было", "Абонементтер жок болду")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table" style={{ marginTop: 8 }}>
            <thead><tr><th>{t("Абонемент", "Абонемент")}</th><th>{t("Секция", "Секция")}</th><th>{t("Период", "Мезгил")}</th><th className="num">{t("Цена", "Баасы")}</th><th>{t("Статус", "Абалы")}</th>{isAdminLike && <th></th>}</tr></thead>
            <tbody>
              {myCards.map((c) => (
                <tr key={c.id} style={{ cursor: "default" }} onClick={(e) => e.stopPropagation()}>
                  <td>{CARD_TYPE_LABEL[c.type]?.[lang] ?? c.type}{c.total_lessons ? ` · ${c.total_lessons} ${t("зан.", "сабак")}` : ""}</td>
                  <td style={{ fontSize: 12 }}>{(() => { const sec = (c as any).section as { name_ru?: string; name_ky?: string } | null; return sec ? (lang === "ru" ? sec.name_ru : sec.name_ky) : "—"; })()}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{fmtD(c.start_date)} → {fmtD(c.end_date)}</td>
                  <td className="num">
                    {formatCurrency(Number(c.price_paid))}
                    {debtOf(c.id) > 0 && (
                      <div style={{ color: "var(--red-600)", fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                        {t("Долг", "Карыз")} {formatCurrency(debtOf(c.id))}
                      </div>
                    )}
                  </td>
                  <td><span className={`pill pill--${c.status}`}>{CARD_STATUS_LABEL[c.status]?.[lang] ?? c.status}</span></td>
                  {isAdminLike && (
                    <td style={{ textAlign: "right", width: 1 }}>
                      {debtOf(c.id) > 0 && can(user?.role, "receive_payment") && (
                        <button
                          className="btn btn--primary"
                          style={{ padding: "4px 8px", fontSize: 11, marginBottom: 4 }}
                          onClick={() => setPayCard({ id: c.id, debt: debtOf(c.id), type: c.type })}
                        >
                          {t("Погасить долг", "Карызды төлөө")}
                        </button>
                      )}
                      {/* «Продлить» доступно и для истёкшей карты: смена даты
                          окончания оживляет её, двигает окно записи и
                          достраивает занятия («до добавить тренировки»).
                          Кнопки «Оплачено» (быстрое продление копией карты)
                          у истёкших больше нет — офис продаёт новый
                          абонемент с нужным числом занятий. */}
                      {(c.status === "active" || c.status === "ending" || c.status === "expired" || c.status === "debt") && (
                        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                          {c.total_lessons != null && (
                            <button
                              className="btn btn--ghost"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              onClick={() => setAddLessonsCard({ id: c.id, type: c.type, total_lessons: c.total_lessons, end_date: c.end_date })}
                              title={t("Добавить занятий к абонементу — срок продлится по расписанию группы", "Абонементке сабак кошуу")}
                            >
                              + {t("занятия", "сабак")}
                            </button>
                          )}
                          {canRemoveLessons && (c.status === "active" || c.status === "ending") && (
                            <button
                              className="btn btn--ghost"
                              style={{ padding: "4px 8px", fontSize: 11 }}
                              onClick={() => setRemoveLessonsCard({ id: c.id, type: c.type, total_lessons: c.total_lessons, start_date: c.start_date, end_date: c.end_date, section_id: c.section_id })}
                              title={t("Снять выбранные предстоящие тренировки с абонемента", "Абонементтен машыгууларды алып салуу")}
                            >
                              − {t("тренировки", "машыгуу")}
                            </button>
                          )}
                          <button className="btn btn--ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => handleExtend(c.id, c.end_date)} disabled={extend.isPending} title={t("Изменить только дату окончания", "Аяктоо күнүн өзгөртүү")}>
                            {t("Продлить", "Узартуу")}
                          </button>
                          {(c.status === "active" || c.status === "ending") && (
                            <>
                              <button
                                className="btn btn--ghost"
                                style={{ padding: "4px 8px", fontSize: 11 }}
                                onClick={() => handleClose(c.id)}
                                disabled={closeCard.isPending}
                                title={t("Заблокировать с сохранением истории посещений", "Тарыхты сактап жабуу")}
                              >
                                {t("Закрыть", "Жабуу")}
                              </button>
                              <button
                                className="btn btn--ghost"
                                style={{ padding: "4px 8px", fontSize: 11, color: "var(--red-600)" }}
                                onClick={() => handleCancel(c.id)}
                                disabled={cancelCard.isPending}
                                title={t("Ошибочная продажа: в архив, без истории", "Ката сатуу: архивге")}
                              >
                                {t("Отменить", "Жокко")}
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {isAdminLike && myCards.length > 0 && (
        <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          {t(
            "«+ занятия» — добавить занятий (срок продлится сам по расписанию группы). «− тренировки» — снять выбранные предстоящие тренировки, число занятий уменьшится. «Продлить» — только сдвинуть дату окончания. «Закрыть» — заблокировать с сохранением истории.",
            "«+ сабак» — сабак кошуу (мөөнөт өзү узарат). «Узартуу» — аяктоо күнүн жылдыруу. «Жабуу» — тарыхты сактап жабуу.",
          )}
        </div>
      )}
      {payCard && (
        <AcceptPaymentModal
          open={!!payCard}
          onClose={() => setPayCard(null)}
          lang={lang}
          presetChildId={childId}
          presetCardId={payCard.id}
          presetAmount={payCard.debt}
          presetComment={t(`Погашение долга по абонементу ${payCard.type}`, `${payCard.type} абонементи боюнча карызды төлөө`)}
        />
      )}
      {addLessonsCard && (
        <AddLessonsModal
          open
          onClose={() => setAddLessonsCard(null)}
          lang={lang}
          childId={childId}
          card={addLessonsCard}
        />
      )}
      {removeLessonsCard && (
        <RemoveLessonsModal
          open
          onClose={() => setRemoveLessonsCard(null)}
          lang={lang}
          childId={childId}
          card={removeLessonsCard}
        />
      )}
    </>
  );
};

// «Удалить тренировки»: список предстоящих тренировок ребёнка по этому
// абонементу с галочками. Выбранные снимаются (card_lesson_exclusions):
// пропадают из карточки, журнала, табеля тренера и состава занятия; число
// занятий абонемента уменьшается на столько же. Снятые можно вернуть.
const RemoveLessonsModal = ({ open, onClose, lang, childId, card }: {
  open: boolean; onClose: () => void; lang: Lang; childId: string;
  card: { id: string; type: string; total_lessons: number | null; start_date: string; end_date: string; section_id: string | null };
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const from = card.start_date > todayStr ? card.start_date : todayStr;
  const { data: lessons = [], isLoading } = useChildLessons(childId, { from, to: card.end_date }, { allCards: true });
  const upcoming = useMemo(
    () => (lessons as any[])
      .filter((l) => l.status === "scheduled" && l.date >= card.start_date && l.date <= card.end_date
        && (!card.section_id || !l.group?.section_id || l.group.section_id === card.section_id))
      .sort((a, b) => (a.date + a.start_time < b.date + b.start_time ? -1 : 1)),
    [lessons, card],
  );
  const { data: exclusions = [] } = useCardLessonExclusions(childId);
  const removed = useMemo(() => exclusions.filter((x) => x.club_card_id === card.id), [exclusions, card.id]);
  const remove = useRemoveCardLessons();
  const restore = useRestoreCardLessons();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const busy = remove.isPending || restore.isPending;
  const toggle = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allSelected = upcoming.length > 0 && upcoming.every((l: any) => sel.has(l.id));
  const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { weekday: "short", day: "2-digit", month: "2-digit" });
  const total = card.total_lessons;

  const submit = async () => {
    if (sel.size === 0) return;
    if (!confirm(t(
      `Снять ${sel.size} тренировок с абонемента? Занятий станет ${total != null ? Math.max(0, total - sel.size) : "—"}.`,
      `${sel.size} машыгууну абонементтен алып салабызбы?`,
    ))) return;
    try {
      await remove.mutateAsync({ card_id: card.id, lesson_ids: Array.from(sel), reason: reason.trim() || null });
      setSel(new Set());
    } catch { /* toast уже показан */ }
  };
  const restoreOne = async (lessonId: string) => {
    try { await restore.mutateAsync({ card_id: card.id, lesson_ids: [lessonId] }); } catch { /* toast */ }
  };

  return (
    <Modal open={open} onClose={onClose} width={520} title={t("Удалить тренировки из абонемента", "Абонементтен машыгууларды алып салуу")}>
      <div style={{ fontSize: 13, marginBottom: 10, padding: "8px 12px", background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
        {t("Абонемент", "Абонемент")}: <b>{card.type}{total != null ? ` · ${total}` : ""}</b> · {fmtD(card.start_date)} → {fmtD(card.end_date)}
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 4 }}>
          {t("Отметьте тренировки, которые снимаем. Число занятий уменьшится на столько же; у ребёнка эти даты пропадут из журнала и табеля тренера.",
             "Алып салуучу машыгууларды белгилеңиз. Сабак саны ошончого азаят.")}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="m-sect__title">{t("Предстоящие тренировки", "Алдыдагы машыгуулар")} · {upcoming.length}</span>
        {upcoming.length > 0 && (
          <button className="btn btn--ghost" style={{ padding: "2px 8px", fontSize: 11 }}
            onClick={() => setSel(allSelected ? new Set() : new Set(upcoming.map((l: any) => l.id)))}>
            {allSelected ? t("Снять выбор", "Тандоону алуу") : t("Выбрать все", "Баарын тандоо")}
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="empty"><div className="empty__title">{t("Загрузка…", "Жүктөлүүдө…")}</div></div>
      ) : upcoming.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Предстоящих тренировок по этому абонементу нет", "Алдыда машыгуу жок")}</div></div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 300, overflowY: "auto", marginBottom: 10 }}>
          {upcoming.map((l: any) => (
            <label key={l.id} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", cursor: "pointer",
              background: sel.has(l.id) ? "var(--red-50)" : "var(--surface)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", fontSize: 13,
            }}>
              <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} disabled={busy} />
              <span style={{ minWidth: 90 }}>{fmtDay(l.date)}</span>
              <span style={{ color: "var(--muted)" }}>{l.start_time?.slice(0, 5)}</span>
              <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: "auto" }}>{lessonPlaceOf(l, lang)}</span>
            </label>
          ))}
        </div>
      )}
      {upcoming.length > 0 && (
        <Field label={t("Причина (необязательно)", "Себеби")}>
          <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("например: ребёнок не будет ходить по пятницам", "мисалы: жума күндөрү келбейт")} />
        </Field>
      )}

      {removed.length > 0 && (
        <>
          <div className="m-sect" style={{ paddingTop: 8 }}>
            <span className="m-sect__title">{t("Снятые тренировки", "Алынган машыгуулар")} · {removed.length}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto", marginBottom: 10 }}>
            {removed.map((x) => (
              <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", background: "var(--bg-soft)", border: "1px dashed var(--line)", borderRadius: "var(--r-sm)", fontSize: 13, color: "var(--muted)" }}>
                <span style={{ minWidth: 90 }}>{x.lesson ? fmtDay(x.lesson.date) : "—"}</span>
                <span>{x.lesson?.start_time?.slice(0, 5) ?? ""}</span>
                <span style={{ fontSize: 12 }}>{x.lesson?.group?.name ?? ""}</span>
                {x.reason && <span style={{ fontSize: 11 }}>· {x.reason}</span>}
                {x.lesson && x.lesson.date >= todayStr && (
                  <button className="btn btn--ghost" style={{ padding: "2px 8px", fontSize: 11, marginLeft: "auto" }} onClick={() => restoreOne(x.lesson_id)} disabled={busy}>
                    {t("Вернуть", "Кайтаруу")}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={busy}>{t("Закрыть", "Жабуу")}</button>
        <button className="btn btn--primary" style={{ background: "var(--red-600)", borderColor: "var(--red-600)" }} onClick={submit} disabled={busy || sel.size === 0}>
          <Icon name="x" size={14} /> {busy ? "…" : t(`Снять ${sel.size || ""}`, `Алып салуу ${sel.size || ""}`)}
        </button>
      </div>
    </Modal>
  );
};

// «+ занятия»: сколько добавить, за сколько и чем оплачено. Срок карты
// пересчитает бэкенд: (остаток + N) будущих занятий по расписанию группы
// должны поместиться до новой даты окончания.
const AddLessonsModal = ({ open, onClose, lang, childId, card }: {
  open: boolean; onClose: () => void; lang: Lang; childId: string;
  card: { id: string; type: string; total_lessons: number | null; end_date: string };
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const add = useAddCardLessons();
  const { data: depositBalance = 0 } = useDepositBalance(childId);
  const [count, setCount] = useState("");
  const [price, setPrice] = useState("0");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [deposit, setDeposit] = useState("0");
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const n = Math.max(0, Math.floor(Number(count) || 0));
  const priceNum = Math.max(0, Number(price) || 0);
  const depositNum = Math.min(Math.max(0, Number(deposit) || 0), priceNum);
  const cashNum = Math.max(0, priceNum - depositNum);
  const depositOver = depositNum > depositBalance + 0.01;
  const total = card.total_lessons ?? 0;

  const submit = async () => {
    setErr(null);
    if (n < 1) { setErr(t("Укажите, сколько занятий добавить", "Канча сабак кошууну көрсөтүңүз")); return; }
    if (depositOver) { setErr(t("Сумма с депозита больше баланса", "Депозиттен сумма баланстан чоң")); return; }
    try {
      await add.mutateAsync({
        card_id: card.id, count: n, price: priceNum,
        payment_method: method, deposit_amount: depositNum,
        comment: comment.trim() || null,
      });
      onClose();
    } catch (e) { setErr((e as Error).message); }
  };

  return (
    <Modal open={open} onClose={onClose} width={460} title={t("Добавить занятия", "Сабак кошуу")}>
      <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 12px", background: "var(--bg-soft)", border: "1px solid var(--line)", borderRadius: "var(--r-sm)" }}>
        {t("Абонемент", "Абонемент")}: <b>{card.type} · {total}</b> {t("занятий", "сабак")} · {t("до", "чейин")} <b>{fmtD(card.end_date)}</b>
        {n > 0 && (
          <div style={{ marginTop: 4 }}>
            {t("Станет", "Болот")}: <b>{total} → {total + n}</b>. {t(`Срок продлится ровно на ${n} занят. по расписанию группы после текущей даты окончания.`, `Мөөнөт топтун жадыбалы боюнча так ${n} сабакка узарат.`)}
          </div>
        )}
      </div>
      <Field label={t("Сколько занятий добавить", "Канча сабак кошуу")}>
        <input type="number" min={1} value={count} onChange={(e) => setCount(e.target.value)} autoFocus placeholder="10" />
      </Field>
      <div className="grid-2">
        <Field label={t("Цена, сом (0 — бесплатно)", "Баасы, сом (0 — акысыз)")}>
          <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <Field label={t("Способ оплаты", "Төлөм ыкмасы")}>
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={cashNum <= 0}>
            <option value="cash">{t("Наличные", "Накта")}</option>
            <option value="terminal">{t("Терминал", "Терминал")}</option>
          </select>
        </Field>
      </div>
      {priceNum > 0 && (
        <Field
          label={t("С депозита", "Депозиттен")}
          hint={`${t("Баланс депозита", "Депозит балансы")}: ${formatCurrency(depositBalance)} · ${t("остаток", "калганы")} ${method === "cash" ? t("наличными", "накта") : t("терминалом", "терминал")}: ${formatCurrency(cashNum)}`}
        >
          <input type="number" min={0} max={Math.min(depositBalance, priceNum)} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
        </Field>
      )}
      <Field label={t("Комментарий (необязательно)", "Комментарий")}>
        <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t("например: компенсация за отмену", "мисалы: компенсация")} />
      </Field>
      {err && <div className="field__error" style={{ marginBottom: 8 }}>{err}</div>}
      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={add.isPending}>{t("Отмена", "Жокко чыгаруу")}</button>
        <button className="btn btn--primary" onClick={submit} disabled={add.isPending || n < 1}>
          <Icon name="plus" size={14} /> {add.isPending ? "…" : t(`Добавить ${n || ""}`, `Кошуу ${n || ""}`)}
        </button>
      </div>
    </Modal>
  );
};

// ============================ Attendance ============================
// «Секция · группа» занятия — чтобы в истории было видно, куда ходил.
const lessonPlaceOf = (l: any, lang: Lang): string => {
  const g = l?.group;
  if (!g) return "—";
  const sec = g.section ? (lang === "ru" ? g.section.name_ru : g.section.name_ky) : null;
  return sec ? `${sec} · ${g.name}` : g.name;
};

const AttTab = ({ childId, lang }: { childId: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  // Год истории: офис просил полную историю посещений, 90 дней мало.
  const { data: attAll = [] } = useAttendanceForChild(childId, 365);
  // История посещений по каждому абонементу (ТЗ §3.2): посещение относится к
  // абонементу, если совпадает секция и дата попадает в срок абонемента.
  const { data: childCards = [] } = useCardsForChild(childId);
  const [cardFilter, setCardFilter] = useState<string>("all");
  const selectedCard = childCards.find((c) => c.id === cardFilter);
  const inSelectedCard = (date?: string | null, sectionId?: string | null) => {
    if (!selectedCard) return true;
    if (!date || date < selectedCard.start_date || date > selectedCard.end_date) return false;
    return !selectedCard.section_id || !sectionId || selectedCard.section_id === sectionId;
  };
  const att = useMemo(
    () => attAll.filter((a) => inSelectedCard(a.lesson?.date, (a.lesson?.group as any)?.section_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [attAll, selectedCard?.id],
  );
  // Отметка прямо из списка (просьба офиса 2026-09-10): пропущенные без
  // отметки — «был / не был», уже отмеченные — переключение одним кликом.
  const canMark = usePerm("manage_schedule");
  const mark = useMarkAttendance();
  const [marking, setMarking] = useState<string | null>(null); // lesson_id в работе
  const setStatus = async (lessonId: string, status: AttendanceStatus) => {
    setMarking(lessonId);
    try {
      await mark.mutateAsync({ lessonId, marks: [{ child_id: childId, status }] });
    } catch { /* toast уже показан */ } finally {
      setMarking(null);
    }
  };
  const present = att.filter((a) => a.status === "present" || a.status === "late" || a.status === "makeup").length;
  const absent = att.filter((a) => a.status === "absent").length;
  const excused = att.filter((a) => a.status === "excused").length;
  const total = att.length;

  // «Предстоит» — будущие запланированные занятия ребёнка в окне
  // абонемента (useChildLessons сам ограничивает картой и total_lessons).
  const todayStr = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const horizon = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 180);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  // Диапазон тянем на год НАЗАД (не от сегодня!) — иначе прошедших занятий
  // в выборке нет и «пропустил» всегда пуст. allCards: считаем по всем
  // картам, включая истёкшие — история должна жить и после конца абонемента.
  const pastStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 365);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }, []);
  const { data: cardLessons = [] } = useChildLessons(childId, { from: pastStr, to: horizon }, { allCards: true });
  const upcomingLessons = useMemo(
    () => (cardLessons as any[])
      .filter((l) => l.date >= todayStr && l.status === "scheduled")
      .sort((a, b) => (a.date + a.start_time < b.date + b.start_time ? -1 : 1)),
    [cardLessons, todayStr],
  );
  const upcoming = upcomingLessons.length;

  // Пропущенные дни: занятия карты, которые уже прошли, но отметки нет
  // (тренер отмечает только пришедших — без этого «Пропустил» всегда 0,
  // жалоба офиса 2026-08-27). Заморозки и отменённые уроки не считаются:
  // useChildLessons их уже исключает / фильтруем по статусу.
  const attendedLessonIds = useMemo(() => new Set(att.map((a) => a.lesson_id)), [att]);
  const missedLessons = useMemo(
    () => (cardLessons as any[])
      .filter((l) => l.date < todayStr && l.status !== "cancelled" && l.status !== "force_majeure" && !attendedLessonIds.has(l.id))
      .filter((l) => inSelectedCard(l.date, l.group?.section_id ?? l.section_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardLessons, attendedLessonIds, todayStr, selectedCard?.id],
  );
  const missed = missedLessons.length;

  // Мини-фильтр: клик по показателю показывает внизу только эти записи,
  // повторный клик — сброс. «Предстоит» показывает будущие занятия с датами.
  type StatFilter = "all" | "present" | "absent" | "excused" | "upcoming";
  const [statFilter, setStatFilter] = useState<StatFilter>("all");
  const toggle = (f: StatFilter) => setStatFilter((cur) => (cur === f ? "all" : f));
  // Сортируем по дате занятия (не по moment отметки — тренеры отмечают
  // задним числом, и список без этого идёт вразброс). Свежие сверху.
  // Пропущенные (без отметки) дни вливаются в общий список со статусом
  // "missed" — офис видит полную историю, а не только «был».
  type HistRow = {
    key: string;
    lessonId: string | null;
    date: string | null;
    time: string;
    place: string;
    status: AttendanceStatus | "missed";
  };
  const filteredAtt = useMemo((): HistRow[] => {
    const attRows: HistRow[] = att.map((a) => ({
      key: a.id,
      lessonId: a.lesson_id,
      date: a.lesson?.date ?? null,
      time: a.lesson?.start_time?.slice(0, 5) ?? "",
      place: lessonPlaceOf(a.lesson, lang),
      status: a.status,
    }));
    const missedRows: HistRow[] = missedLessons.map((l: any) => ({
      key: `miss-${l.id}`,
      lessonId: l.id,
      date: l.date,
      time: l.start_time?.slice(0, 5) ?? "",
      place: lessonPlaceOf(l, lang),
      status: "missed",
    }));
    const base =
      statFilter === "present" ? attRows.filter((r) => r.status === "present" || r.status === "late" || r.status === "makeup") :
      statFilter === "absent" ? [...attRows.filter((r) => r.status === "absent"), ...missedRows] :
      statFilter === "excused" ? attRows.filter((r) => r.status === "excused") :
      [...attRows, ...missedRows];
    return base.sort((a, b) =>
      ((b.date ?? "") + b.time).localeCompare((a.date ?? "") + a.time));
  }, [att, missedLessons, statFilter, lang]);

  const fmtDate = (d?: string | null) =>
    d ? new Date(d).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG") : "—";

  const lessonPlace = (l: any): string => lessonPlaceOf(l, lang);

  const pillBtn = (f: StatFilter): CSSProperties => ({
    cursor: "pointer",
    borderRadius: 8,
    padding: "2px 8px",
    margin: "-2px -8px",
    outline: statFilter === f ? "2px solid var(--blue)" : "none",
  });

  return (
    <>
      {childCards.length > 1 && (
        <div style={{ marginBottom: 10 }}>
          <select value={cardFilter} onChange={(e) => setCardFilter(e.target.value)} style={{ height: 34, padding: "0 10px", border: "1px solid var(--line)", borderRadius: "var(--r-sm)", fontSize: 13 }}>
            <option value="all">{t("Все абонементы", "Бардык абонементтер")}</option>
            {childCards.map((c) => {
              const sec = (c as any).section as { name_ru?: string; name_ky?: string } | null;
              return (
                <option key={c.id} value={c.id}>
                  {CARD_TYPE_LABEL[c.type]?.[lang] ?? c.type}
                  {sec ? ` · ${lang === "ru" ? sec.name_ru : sec.name_ky}` : ""}
                  {` · ${fmtD(c.start_date)} → ${fmtD(c.end_date)}`}
                </option>
              );
            })}
          </select>
        </div>
      )}
      <div className="summary-pill" style={{ marginBottom: 12 }}>
        <div style={pillBtn("present")} onClick={() => toggle("present")} title={t("Показать только «был»", "«Болду» гана")}>
          <div className="summary-pill__val" style={{ color: "var(--green)" }}>{present}</div><div className="summary-pill__lbl">{t("Был", "Болду")}</div>
        </div>
        <div className="summary-pill__sep" />
        <div style={pillBtn("absent")} onClick={() => toggle("absent")} title={t("Пропуски: отмеченные «не был» + прошедшие занятия без отметки", "Калтыруулар: «болгон жок» + белгиленбеген өткөн сабактар")}>
          <div className="summary-pill__val" style={{ color: "var(--red)" }}>{absent + missed}</div><div className="summary-pill__lbl">{t("Пропустил", "Калтырды")}</div>
        </div>
        <div className="summary-pill__sep" />
        <div style={pillBtn("excused")} onClick={() => toggle("excused")} title={t("Показать только уважительные", "Себептүү гана")}>
          <div className="summary-pill__val">{excused}</div><div className="summary-pill__lbl">{t("Уваж.", "Уюшт.")}</div>
        </div>
        <div className="summary-pill__sep" />
        <div style={pillBtn("upcoming")} onClick={() => toggle("upcoming")} title={t("Показать предстоящие занятия с датами", "Алдыдагы сабактар")}>
          <div className="summary-pill__val" style={{ color: "var(--yellow-ink, var(--ink))" }}>{upcoming}</div><div className="summary-pill__lbl">{t("Предстоит", "Алдыда")}</div>
        </div>
        <div className="summary-pill__sep" />
        <div style={{ marginLeft: "auto" }}><div className="summary-pill__val" style={{ color: "var(--blue)" }}>{(total + missed) ? Math.round((present / (total + missed)) * 100) : 0}%</div><div className="summary-pill__lbl">{t("Посещ.", "Катыш.")}</div></div>
      </div>
      {statFilter === "upcoming" ? (
        upcomingLessons.length === 0 ? (
          <div className="empty"><div className="empty__title">{t("Предстоящих занятий нет", "Алдыда сабак жок")}</div></div>
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead><tr><th>{t("Дата", "Күн")}</th><th>{t("Время", "Убакыт")}</th><th>{t("Группа", "Топ")}</th><th>{t("Статус", "Абалы")}</th></tr></thead>
              <tbody>
                {upcomingLessons.map((l: any) => (
                  <tr key={l.id}>
                    <td>{fmtDate(l.date)}</td>
                    <td style={{ color: "var(--muted)" }}>{l.start_time?.slice(0, 5) ?? ""}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{lessonPlace(l)}</td>
                    <td><span className="pill pill--frozen" style={{ background: "var(--blue-50, var(--bg-soft))", color: "var(--blue)" }}>{t("предстоит", "алдыда")}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : filteredAtt.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Записей пока нет", "Жазуу жок")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th>{t("Дата", "Күн")}</th><th>{t("Время", "Убакыт")}</th><th>{t("Секция / группа", "Секция / топ")}</th><th>{t("Статус", "Абалы")}</th></tr></thead>
            <tbody>
              {filteredAtt.map((r) => (
                <tr key={r.key}>
                  <td>{fmtDate(r.date)}</td>
                  <td style={{ color: "var(--muted)" }}>{r.time}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{r.place}</td>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {r.status === "missed" ? (
                        <span
                          className="pill pill--expired"
                          style={{ opacity: 0.75 }}
                          title={t("Занятие прошло, отметки тренера нет", "Сабак өттү, белги жок")}
                        >
                          {t("пропустил", "калтырды")}
                        </span>
                      ) : (
                        <span className={`pill pill--${r.status === "present" ? "active" : r.status === "absent" ? "expired" : "frozen"}`}>{r.status}</span>
                      )}
                      {canMark && r.lessonId && (
                        <span style={{ display: "inline-flex", gap: 4 }}>
                          {r.status !== "present" && (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{ padding: "2px 8px", fontSize: 11, height: 22, color: "var(--green)" }}
                              disabled={marking === r.lessonId}
                              title={t("Отметить «был»", "«Болду» деп белгилөө")}
                              onClick={() => setStatus(r.lessonId!, "present")}
                            >
                              {marking === r.lessonId ? "…" : <><Icon name="check" size={11} stroke={3} /> {t("был", "болду")}</>}
                            </button>
                          )}
                          {r.status !== "absent" && (
                            <button
                              type="button"
                              className="btn btn--ghost"
                              style={{ padding: "2px 8px", fontSize: 11, height: 22, color: "var(--red-600)" }}
                              disabled={marking === r.lessonId}
                              title={t("Отметить «не был»", "«Болгон жок» деп белгилөө")}
                              onClick={() => setStatus(r.lessonId!, "absent")}
                            >
                              {marking === r.lessonId ? "…" : <><Icon name="x" size={11} stroke={3} /> {t("не был", "болгон жок")}</>}
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ============================ Payments ============================
const PayTab = ({ childId, lang }: { childId: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: my = [] } = usePaymentsForChild(childId);
  const total = my.reduce((s, p) => s + Number(p.amount), 0);

  return (
    <>
      <div style={{ display: "flex", gap: 16, marginBottom: 12 }}>
        <div><div style={{ fontSize: 11, color: "var(--muted)" }}>{t("LTV (всего оплачено)", "LTV")}</div>
        <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)" }}>{formatCurrency(total)}</div></div>
        <div><div style={{ fontSize: 11, color: "var(--muted)" }}>{t("Платежей", "Төлөмдөр")}</div>
        <div style={{ fontSize: 24, fontWeight: 700, fontFamily: "var(--font-display)" }}>{my.length}</div></div>
      </div>
      {my.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Платежей нет", "Төлөмдөр жок")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th>{t("Дата", "Күн")}</th><th>{t("Абонемент", "Абонемент")}</th><th>{t("Способ оплаты", "Төлөм ыкмасы")}</th><th>{t("Менеджер", "Менеджер")}</th><th>{t("Комментарий", "Комментарий")}</th><th className="num">{t("Сумма", "Сумма")}</th></tr></thead>
            <tbody>
              {my.map((p) => {
                const card = (p as any).card as { type?: string; section?: { name_ru?: string; name_ky?: string } | null } | null;
                return (
                <tr key={p.id}>
                  <td>{new Date(p.paid_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}</td>
                  <td style={{ fontSize: 12 }}>
                    {card?.type ? (CARD_TYPE_LABEL[card.type]?.[lang] ?? card.type) : "—"}
                    {card?.section && <span style={{ color: "var(--muted)" }}> · {lang === "ru" ? card.section.name_ru : card.section.name_ky}</span>}
                  </td>
                  <td style={{ color: "var(--muted)" }}>{p.method === "cash" ? t("Наличные", "Накта") : p.method === "terminal" ? t("Терминал", "Терминал") : p.method}</td>
                  <td style={{ fontSize: 12 }}>{p.receiver?.full_name ?? "—"}</td>
                  <td style={{ color: "var(--muted)", fontSize: 12 }}>{p.comment ?? "—"}</td>
                  <td className="num">{formatCurrency(Number(p.amount))}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ============================ Deposit ============================
const DepositTab = ({ childId, role, lang }: { childId: string; role: Role; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { user } = useAuth();
  const isAdminLike = role === "admin";
  // Возврат депозита с 2026-09-10 доступен и менеджерам (просьба офиса).
  const canWithdraw = isAdminLike && can(user?.role, "receive_payment") &&
    (user?.role === "director" || user?.role === "fitness_director" || user?.role === "senior_manager" || user?.role === "manager");
  const { data: balance = 0 } = useDepositBalance(childId);
  const { data: history = [] } = useDepositHistory(childId, 100);
  const debts = useChildCardDebts(childId);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [payDebt, setPayDebt] = useState<{ id: string; debt: number; type: string } | null>(null);

  const typeLabel = (type: string) => {
    switch (type) {
      case "top_up": return t("Пополнение", "Толтуруу");
      case "withdraw": return t("Вывод", "Чыгаруу");
      case "card_purchase": return t("Покупка абонемента", "Абонемент сатып алуу");
      case "card_renewal": return t("Продление абонемента", "Абонемент узартуу");
      case "refund_in": return t("Возврат", "Кайтаруу");
      case "service_charge": return t("Услуга / штраф", "Кызмат / айып");
      case "adjustment": return t("Корректировка", "Корректировка");
      default: return type;
    }
  };
  const typeColor = (type: string): string => {
    if (type === "top_up" || type === "refund_in") return "var(--green)";
    if (type === "withdraw" || type === "card_purchase" || type === "card_renewal" || type === "service_charge")
      return "var(--red-600)";
    return "var(--muted)";
  };

  return (
    <>
      <div style={{
        padding: "16px 18px", background: "var(--bg-soft)",
        border: "1px solid var(--line)", borderRadius: "var(--r-md)",
        display: "flex", flexDirection: "column", gap: 8, marginBottom: 14,
      }}>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>{t("Текущий баланс", "Учурдагы баланс")}</div>
        <div style={{ fontSize: 32, fontWeight: 700, fontFamily: "var(--font-display)", color: balance > 0 ? "var(--green)" : "var(--ink)" }}>
          {formatCurrency(balance)}
        </div>
        {/* Долг по абонементу: остаток основной суммы (цена со скидкой − оплачено). */}
        {debts.total > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", paddingTop: 6, borderTop: "1px dashed var(--line)" }}>
            <span className="pill pill--expired" style={{ fontWeight: 700 }}>
              {t("Долг", "Карыз")}: {formatCurrency(debts.total)}
            </span>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {debts.data.map((d) => `${d.type} ${fmtD(d.start_date)}–${fmtD(d.end_date)}: ${t("оплачено", "төлөндү")} ${formatCurrency(d.paid)} ${t("из", "/")} ${formatCurrency(d.price)}`).join(" · ")}
            </span>
            {isAdminLike && can(user?.role, "receive_payment") && (
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto", padding: "4px 10px", fontSize: 12 }}
                onClick={() => { const d = debts.data[0]; if (d) setPayDebt({ id: d.card_id, debt: d.debt, type: d.type }); }}
              >
                {t("Погасить долг", "Карызды төлөө")}
              </button>
            )}
          </div>
        )}
      </div>

      {isAdminLike && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          <button className="btn btn--primary" onClick={() => setTopUpOpen(true)}>
            <Icon name="plus" size={14} /> {t("Пополнить", "Толтуруу")}
          </button>
          {canWithdraw && (
            <button className="btn" onClick={() => setWithdrawOpen(true)} disabled={balance <= 0}>
              <Icon name="download" size={14} /> {t("Вывести", "Чыгаруу")}
            </button>
          )}
        </div>
      )}

      {history.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{t("Операций ещё не было", "Операциялар жок")}</div>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Дата", "Күн")}</th>
                <th>{t("Тип", "Түрү")}</th>
                <th className="num">{t("Сумма", "Сумма")}</th>
                <th className="num">{t("Остаток", "Калдык")}</th>
                <th>{t("Кто", "Ким")}</th>
                <th>{t("Комментарий", "Комментарий")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((tx) => {
                const color = typeColor(tx.type);
                const sign = Number(tx.amount) > 0 ? "+" : "";
                return (
                  <tr key={tx.id}>
                    <td>{new Date(tx.paid_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}</td>
                    <td>{typeLabel(tx.type)}</td>
                    <td className="num" style={{ color, fontWeight: 600 }}>
                      {sign}{formatCurrency(Number(tx.amount))}
                    </td>
                    <td className="num">{formatCurrency(Number(tx.balance_after))}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {tx.receiver?.full_name ?? "—"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{tx.comment ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <TopUpDepositModal
        open={topUpOpen}
        onClose={() => setTopUpOpen(false)}
        lang={lang}
        presetChildId={childId}
      />
      <WithdrawDepositModal
        open={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        lang={lang}
        presetChildId={childId}
      />
      {payDebt && (
        <AcceptPaymentModal
          open={!!payDebt}
          onClose={() => setPayDebt(null)}
          lang={lang}
          presetChildId={childId}
          presetCardId={payDebt.id}
          presetAmount={payDebt.debt}
          presetComment={t(`Погашение долга по абонементу ${payDebt.type}`, `${payDebt.type} абонементи боюнча карызды төлөө`)}
        />
      )}
    </>
  );
};

// ============================ Freezes ============================
// Заморозка ставится НА КОНКРЕТНЫЙ АБОНЕМЕНТ. Раньше вкладка брала первую
// попавшуюся карту со статусом 'active' — и если у ребёнка карта была
// 'ending' (≤5 дней до конца), 'frozen' или в долге, кнопка заморозки
// вообще не появлялась. Остаток занятий на возможность заморозки не влияет:
// поставить паузу можно и когда осталась одна тренировка.
const FREEZE_OUTCOME_LBL: Record<string, { ru: string; ky: string; cls: string }> = {
  pending:  { ru: "Ожидает",   ky: "Күтүүдө",        cls: "frozen" },
  active:   { ru: "Действует", ky: "Колдонулууда",   cls: "active" },
  finished: { ru: "Завершена", ky: "Аяктады",        cls: "archived" },
  rejected: { ru: "Отклонена", ky: "Четке кагылды",  cls: "expired" },
};

const FreezesTab = ({ childId, role, lang }: { childId: string; role: Role; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: freezes = [] } = useFreezes();
  const { data: cards = [] } = useCardsForChild(childId);
  const { data: balances = [] } = useCardBalancesForChild(childId);
  const my = freezes.filter((f) => f.child_id === childId);

  // Все абонементы ребёнка кроме архивных. Порядок: сначала действующие.
  const STATUS_RANK: Record<string, number> = {
    active: 0, ending: 1, frozen: 2, debt: 3, expired: 4,
  };
  const freezable = useMemo(
    () => cards
      .filter((c) => c.status !== "archived")
      .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9)),
    [cards],
  );
  const remainingOf = (cardId: string) =>
    balances.find((b) => b.club_card_id === cardId)?.remaining ?? null;

  const create = useCreateFreeze();
  const endFreeze = useEndFreeze();
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [cardId, setCardId] = useState("");
  const todayStr = new Date().toISOString().slice(0, 10);
  const in14Str = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(in14Str);
  const [err, setErr] = useState<string | null>(null);

  // Карта по умолчанию — первая действующая. Пересчитываем, когда карты
  // подгрузились или выбранная исчезла из списка.
  const effectiveCardId = cardId && freezable.some((c) => c.id === cardId)
    ? cardId
    : freezable[0]?.id ?? "";
  const selectedCard = freezable.find((c) => c.id === effectiveCardId);

  const handleEnd = (id: string) => {
    if (!confirm(t("Снять заморозку досрочно?", "Тындырууну мөөнөтүнөн мурда токтотуу?"))) return;
    endFreeze.mutate(id);
  };

  const submit = async () => {
    setErr(null);
    if (!selectedCard || !reason || !startDate || !endDate) return;
    if (endDate < startDate) {
      setErr(t("Дата окончания раньше даты начала", "Аяктоо күнү башталыштан эрте"));
      return;
    }
    try {
      await create.mutateAsync({
        child_id: childId,
        club_card_id: selectedCard.id,
        reason,
        start_date: startDate,
        end_date: endDate,
      });
      setReason(""); setOpen(false);
      setStartDate(todayStr); setEndDate(in14Str);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const days = Math.max(0, Math.round(
    (new Date(endDate + "T00:00:00").getTime() - new Date(startDate + "T00:00:00").getTime()) / 86400000,
  ) + 1);

  // Заморозку ставит только офис (решение клиента 2026-08-04): у тренера
  // и родителя кнопки нет — бэкенд их всё равно отклоняет (403).
  const canRequest = role === "admin";

  return (
    <>
      {canRequest && (
        freezable.length === 0 ? (
          <div style={{
            padding: "10px 12px", marginBottom: 12,
            background: "var(--bg-soft)", border: "1px dashed var(--line)",
            borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--muted)",
          }}>
            {t(
              "Заморозка ставится на абонемент, а у ребёнка нет ни одного. Продайте абонемент во вкладке «Абонементы».",
              "Тындыруу абонементке коюлат, бирала абонемент жок. «Абонементтер» табынан сатыңыз.",
            )}
          </div>
        ) : !open ? (
          <button className="btn btn--primary" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
            <Icon name="plus" /> {t("Заморозить абонемент", "Абонементти тындыруу")}
          </button>
        ) : (
          <div className="card" style={{ padding: 12, marginBottom: 12 }}>
            <Field
              label={t("Какой абонемент замораживаем", "Кайсы абонемент")}
              hint={selectedCard
                ? t(
                    `Абонемент продлится на срок заморозки. Остаток занятий значения не имеет.`,
                    `Абонемент тындыруу мөөнөтүнө узартылат.`,
                  )
                : undefined}
            >
              <select value={effectiveCardId} onChange={(e) => setCardId(e.target.value)}>
                {freezable.map((c) => {
                  const rem = remainingOf(c.id);
                  return (
                    <option key={c.id} value={c.id}>
                      {c.type}
                      {c.total_lessons ? ` · ${c.total_lessons}` : ""}
                      {rem != null ? ` · ${t("остаток", "калдык")} ${rem}` : ""}
                      {` · ${fmtD(c.start_date)} → ${fmtD(c.end_date)}`}
                      {` · ${c.status}`}
                    </option>
                  );
                })}
              </select>
            </Field>
            <div className="grid-2">
              <Field label={t("С даты", "Качандан")}>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
              <Field label={t("По дату", "Качанга")}>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </Field>
            </div>
            {selectedCard && endDate >= startDate && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                {t("Заморозка на", "Тындыруу")} <b>{days}</b> {t("дн.", "күн")} ·{" "}
                {t("абонемент будет действовать до", "абонемент күчүндө болот")}{" "}
                <b>{new Date(new Date(selectedCard.end_date + "T00:00:00").getTime() + days * 86400000)
                  .toISOString().slice(0, 10)}</b>
              </div>
            )}
            <Field label={t("Причина", "Себеп")}>
              <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            {err && <div className="field__error" style={{ marginBottom: 8 }}>{err}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="btn" onClick={() => { setOpen(false); setReason(""); setErr(null); }}>{t("Отмена", "Жокко")}</button>
              <button className="btn btn--primary" onClick={submit} disabled={create.isPending || !reason || !selectedCard || endDate < startDate}>
                {create.isPending ? "…" : t("Создать", "Түзүү")}
              </button>
            </div>
          </div>
        )
      )}
      {my.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Заморозок не было", "Тындыруу жок")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead><tr><th>{t("Период", "Мезгил")}</th><th>{t("Инициатор", "Демилгечи")}</th><th>{t("Причина", "Себеп")}</th><th>{t("Статус", "Абалы")}</th>{role === "admin" && <th></th>}</tr></thead>
            <tbody>
              {my.map((f) => {
                const outcome = freezeOutcome(f);
                const lbl = FREEZE_OUTCOME_LBL[outcome]!;
                return (
                  <tr key={f.id} style={{ cursor: "default" }} onClick={(e) => e.stopPropagation()}>
                    <td>
                      {f.start_date && f.end_date
                        ? <>{fmtD(f.start_date)} → {fmtD(f.end_date)}</>
                        : new Date(f.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}
                      {f.applied_days ? (
                        <div className="cell-sub">+{f.applied_days} {t("дн. к абонементу", "күн абонементке")}</div>
                      ) : null}
                    </td>
                    <td style={{ color: "var(--muted)" }}>{f.initiator?.full_name ?? f.initiator_role}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{f.reason ?? "—"}</td>
                    <td><span className={`pill pill--${lbl.cls}`}>{lbl[lang]}</span></td>
                    {role === "admin" && (
                      <td style={{ textAlign: "right", width: 1 }}>
                        {f.status === "approved" && (
                          <button className="btn btn--ghost" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => handleEnd(f.id)} disabled={endFreeze.isPending}>
                            {t("Снять", "Алып салуу")}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
};

// ============================ Progress notes ============================
const NotesTab = ({ childId, role, userId, lang }: { childId: string; role: Role; userId: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: notes = [] } = useProgressNotes(childId);
  const add = useAddProgressNote();
  const [text, setText] = useState("");
  const [pub, setPub] = useState(true);
  const [open, setOpen] = useState(false);

  const submit = async () => {
    if (!text || !userId) return;
    await add.mutateAsync({ child_id: childId, coach_id: userId, text, is_public: pub });
    setText(""); setOpen(false);
  };

  return (
    <>
      {role === "coach" && (
        <>
          {!open ? (
            <button className="btn btn--primary" style={{ marginBottom: 12 }} onClick={() => setOpen(true)}>
              <Icon name="plus" /> {t("Добавить заметку", "Жазма кошуу")}
            </button>
          ) : (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <Field label={t("Текст заметки", "Жазма тексти")}>
                <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={pub} onChange={(e) => setPub(e.target.checked)} />
                <span><b>{t("Показать родителю", "Ата-энеге көрсөтүү")}</b><small>{t("Публичные заметки попадают в родительский PWA", "Жалпы жазмалар ата-энеге көрүнөт")}</small></span>
              </label>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => { setOpen(false); setText(""); }}>{t("Отмена", "Жокко")}</button>
                <button className="btn btn--primary" onClick={submit} disabled={add.isPending || !text}>
                  {add.isPending ? "…" : t("Сохранить", "Сактоо")}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {notes.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Заметок нет", "Жазмалар жок")}</div></div>
      ) : (
        notes.map((n) => (
          <div key={n.id} className="coach-note">
            <div className="coach-note__head">
              {n.is_public ? <span style={{ color: "var(--green)" }}>● {t("Публичная", "Жалпы")}</span> : <span style={{ color: "var(--muted)" }}>○ {t("Внутренняя", "Ички")}</span>}
            </div>
            <div className="coach-note__text">{n.text}</div>
            <div className="coach-note__sig">— {n.coach?.full_name ?? ""}, {new Date(n.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG")}</div>
          </div>
        ))
      )}
    </>
  );
};

// ============================ Group (admin) ============================
const GroupTab = ({ childId, childName, lang }: { childId: string; childName: string; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: enrollments = [], isLoading } = useChildEnrollments(childId);
  const { data: allGroups = [] } = useGroups();
  const { data: activeCards = [] } = useChildActiveCards(childId);
  const addEnroll = useAddEnrollment();
  const removeEnroll = useRemoveEnrollment();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickSection, setPickSection] = useState<string>("all");
  // Шаг выбора даты: «с какой даты добавить ребёнка в группу».
  // Нужен при переводе между группами задним числом / с будущей даты.
  const [addTarget, setAddTarget] = useState<{ id: string; name: string; section_id: string | null } | null>(null);
  const [addDate, setAddDate] = useState("");

  const enrolledGroupIds = useMemo(
    () => new Set(enrollments.map((e: any) => e.group_id)),
    [enrollments],
  );

  const candidates = useMemo(() => {
    return allGroups.filter((g: any) => {
      if (enrolledGroupIds.has(g.id)) return false;
      if (pickSection !== "all" && g.section_id !== pickSection) return false;
      return true;
    });
  }, [allGroups, enrolledGroupIds, pickSection]);

  const sectionsList = useMemo(() => {
    const seen = new Map<string, { id: string; name_ru: string; name_ky: string }>();
    for (const g of allGroups as any[]) {
      if (g.section && !seen.has(g.section.id)) seen.set(g.section.id, g.section);
    }
    return Array.from(seen.values());
  }, [allGroups]);

  // Какие секции «покрыты» активными абонементами ребёнка.
  const coveredSectionIds = useMemo(
    () => new Set(activeCards.map((c) => c.section_id).filter((id): id is string => !!id)),
    [activeCards],
  );
  const hasAnyActive = activeCards.length > 0;
  const hasOnlyLegacy = hasAnyActive && coveredSectionIds.size === 0;

  const checkGroup = (groupSectionId: string | null): { ok: true } | { ok: false; reason: "no_card" | "wrong_section" | "legacy_card" } => {
    if (!hasAnyActive) return { ok: false, reason: "no_card" };
    if (hasOnlyLegacy) return { ok: false, reason: "legacy_card" };
    if (groupSectionId && coveredSectionIds.has(groupSectionId)) return { ok: true };
    return { ok: false, reason: "wrong_section" };
  };

  const handleRemove = async (enrollmentId: string, groupName: string) => {
    if (!confirm(t(`Убрать из группы «${groupName}»?`, `«${groupName}» тобунан чыгарасызбы?`))) return;
    await removeEnroll.mutateAsync(enrollmentId);
  };
  // Шаг 1: клик «Добавить» открывает выбор даты. По умолчанию — сегодня,
  // либо старт карты, если он в будущем.
  const openAdd = (g: any) => {
    const card = activeCards.find((c) => c.section_id && c.section_id === g.section_id);
    const today = new Date().toISOString().slice(0, 10);
    const def = card?.start_date && card.start_date > today ? card.start_date : today;
    setAddTarget({ id: g.id, name: g.name, section_id: g.section_id ?? null });
    setAddDate(def);
  };

  // Шаг 2: подтверждение — окно записи от выбранной даты: конец = дата
  // N-го занятия по расписанию группы (N = total_lessons карты).
  const handleAdd = async () => {
    if (!addTarget || !addDate) return;
    const card = activeCards.find((c) => c.section_id && c.section_id === addTarget.section_id);
    let end_date: string | null = null;
    if (card) {
      const { data: schedule } = await supabase
        .from("group_schedule")
        .select("day_of_week, start_time")
        .eq("group_id", addTarget.id);
      end_date = computeWindowEnd(addDate, card.total_lessons ?? 0, schedule ?? []) ?? card.end_date ?? null;
    }
    await addEnroll.mutateAsync({
      child_id: childId, group_id: addTarget.id,
      start_date: card ? addDate : null, end_date,
    });
    setAddTarget(null);
    setPickerOpen(false);
  };

  return (
    <>
      {isLoading ? (
        <div className="empty"><div className="empty__title">{t("Загрузка…", "Жүктөлүүдө…")}</div></div>
      ) : enrollments.length === 0 ? (
        <div className="empty">
          <div className="empty__title">{t("Ребёнок не состоит ни в одной группе", "Бала эч бир топто жок")}</div>
          <div>{childName}</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {enrollments.map((e: any) => {
            const g = e.group;
            if (!g) return null;
            const secName = lang === "ru" ? g.section?.name_ru : g.section?.name_ky;
            const coachName = g.coach?.full_name ?? "—";
            return (
              <div
                key={e.id}
                style={{
                  display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 12px",
                  background: "var(--bg-soft)",
                  border: "1px solid var(--line)",
                  borderRadius: "var(--r-sm)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="cell-main">{g.name}</div>
                  <div className="cell-sub" style={{ fontSize: 11 }}>
                    {secName ?? "—"} · {coachName}
                  </div>
                </div>
                <button
                  className="btn btn--ghost"
                  style={{ padding: "6px 10px", fontSize: 12, color: "var(--red-600)" }}
                  onClick={() => handleRemove(e.id, g.name)}
                  disabled={removeEnroll.isPending}
                >
                  {t("Убрать", "Чыгаруу")}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        {!pickerOpen ? (
          <button className="btn btn--primary" onClick={() => setPickerOpen(true)}>
            <Icon name="plus" size={14} /> {t("Добавить в группу", "Топко кошуу")}
          </button>
        ) : (
          <div className="card" style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <select
                value={pickSection}
                onChange={(e) => setPickSection(e.target.value)}
                style={{
                  height: 36, padding: "0 10px",
                  border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
                  background: "var(--bg-soft)", fontSize: 13, color: "var(--ink)",
                }}
              >
                <option value="all">{t("Все секции", "Бардык секциялар")}</option>
                {sectionsList.map((s) => (
                  <option key={s.id} value={s.id}>{lang === "ru" ? s.name_ru : s.name_ky}</option>
                ))}
              </select>
              <button className="btn btn--ghost" onClick={() => setPickerOpen(false)}>
                {t("Закрыть", "Жабуу")}
              </button>
            </div>
            {!hasAnyActive && (
              <div style={{
                padding: "8px 10px", marginBottom: 8,
                background: "var(--red-50)", border: "1px solid var(--red-100)",
                borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--red-600)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <Icon name="info" size={12} />
                {t(
                  "У ребёнка нет активного абонемента. Сначала продайте абонемент во вкладке «Абонемент».",
                  "Балада активдүү абонемент жок. Адегенде «Абонемент» табынан абонемент сатыңыз.",
                )}
              </div>
            )}
            {hasOnlyLegacy && (
              <div style={{
                padding: "8px 10px", marginBottom: 8,
                background: "var(--yellow-50, var(--bg-soft))", border: "1px solid var(--line)",
                borderRadius: "var(--r-sm)", fontSize: 12, color: "var(--ink)",
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <Icon name="info" size={12} />
                {t(
                  "У активного абонемента не указана секция. Обновите абонемент перед записью в группу.",
                  "Активдүү абонементте секция көрсөтүлгөн эмес. Топко жазардан мурда абонементти жаңылаңыз.",
                )}
              </div>
            )}
            {addTarget && (
              <div style={{
                padding: "10px 12px", marginBottom: 8,
                background: "var(--bg-soft)", border: "1px solid var(--blue)",
                borderRadius: "var(--r-sm)",
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {t(`С какой даты добавить в «${addTarget.name}»?`, `«${addTarget.name}» тобуна качантан кошобуз?`)}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    type="date"
                    value={addDate}
                    onChange={(e) => setAddDate(e.target.value)}
                    style={{
                      height: 36, padding: "0 10px",
                      border: "1px solid var(--line)", borderRadius: "var(--r-sm)",
                      background: "#fff", fontSize: 13,
                    }}
                  />
                  <button
                    className="btn btn--primary"
                    style={{ padding: "8px 14px", fontSize: 12 }}
                    onClick={handleAdd}
                    disabled={addEnroll.isPending || !addDate}
                  >
                    {addEnroll.isPending ? t("Добавляю…", "Кошулууда…") : t("Добавить с этой даты", "Ушул күндөн кошуу")}
                  </button>
                  <button className="btn btn--ghost" style={{ padding: "8px 12px", fontSize: 12 }} onClick={() => setAddTarget(null)}>
                    {t("Отмена", "Жокко чыгаруу")}
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
                  {t(
                    "До этой даты ребёнок в табеле группы не появится. Окно посещений считается от выбранной даты.",
                    "Бул күнгө чейин бала топтун табелинде көрүнбөйт. Каттоо терезеси тандалган күндөн эсептелет.",
                  )}
                </div>
              </div>
            )}
            {candidates.length === 0 ? (
              <div className="empty">
                <div className="empty__title">{t("Нет доступных групп", "Бош топ жок")}</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                {candidates.map((g: any) => {
                  const filled = (g.enrollments ?? []).filter((e: any) => e.archived_at == null).length;
                  const isFull = filled >= g.max_capacity;
                  const secName = lang === "ru" ? g.section?.name_ru : g.section?.name_ky;
                  const verdict = checkGroup(g.section_id ?? null);
                  const blockedByCard = !verdict.ok;
                  const reasonText = !verdict.ok
                    ? verdict.reason === "no_card"
                      ? t("Нет активного абонемента", "Активдүү абонемент жок")
                      : verdict.reason === "legacy_card"
                        ? t("У абонемента нет секции — обновите", "Абонементте секция жок")
                        : t(`Нужен абонемент на «${secName ?? "—"}»`, `«${secName ?? "—"}» секциясына абонемент керек`)
                    : "";
                  const disabled = addEnroll.isPending || isFull || blockedByCard;
                  const titleAttr = isFull
                    ? t("Группа заполнена", "Топ толду")
                    : blockedByCard ? reasonText : undefined;
                  return (
                    <div
                      key={g.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "8px 10px",
                        background: blockedByCard ? "var(--bg-soft)" : "var(--surface)",
                        border: "1px solid var(--line)",
                        borderRadius: "var(--r-sm)",
                        opacity: blockedByCard ? 0.7 : 1,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="cell-main" style={{ fontSize: 13 }}>{g.name}</div>
                        <div className="cell-sub" style={{ fontSize: 11 }}>
                          {secName ?? "—"} · {filled}/{g.max_capacity} {t("мест", "орун")}
                        </div>
                        {blockedByCard && (
                          <div style={{ fontSize: 11, color: "var(--red-600)", marginTop: 2 }}>
                            {reasonText}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn btn--primary"
                        style={{ padding: "6px 10px", fontSize: 12 }}
                        onClick={() => openAdd(g)}
                        disabled={disabled}
                        title={titleAttr}
                      >
                        <Icon name="plus" size={12} /> {t("Добавить", "Кошуу")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
};

// ============================ Internal comments (admin) ============================
// Два потока комментариев в одной таблице (роль автора решает):
//   «от менеджеров» — видит только офис; «от тренера» — офис + сам тренер
//   (RLS отдаёт тренеру только его записи). Родитель не видит ничего —
//   для него есть «Прогресс».
const CommentsTab = ({ childId, lang, viewerRole }: { childId: string; lang: Lang; viewerRole: Role }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: comments = [], isLoading } = useChildComments(childId);
  const add = useAddChildComment();
  // Удаление комментариев запрещено (ТЗ §2.2) — только добавление.
  const [text, setText] = useState("");
  const isCoachViewer = viewerRole === "coach";

  const coachComments = comments.filter((c: any) => c.author?.role === "coach");
  const officeComments = comments.filter((c: any) => c.author?.role !== "coach");

  const submit = async () => {
    const v = text.trim();
    if (!v) return;
    await add.mutateAsync({ child_id: childId, text: v });
    setText("");
  };

  const renderList = (list: typeof comments) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {list.map((c) => (
            <div
              key={c.id}
              style={{
                padding: "10px 12px",
                background: "var(--bg-soft)",
                border: "1px solid var(--line)",
                borderRadius: "var(--r-sm)",
              }}
            >
              <div style={{ fontSize: 14, color: "var(--ink)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {c.text}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>
                  {c.author?.full_name ?? "—"} ·{" "}
                  {new Date(c.created_at).toLocaleDateString(lang === "ru" ? "ru-RU" : "ky-KG", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
            </div>
          ))}
    </div>
  );

  const sectionTitle = (txt: string, hint: string) => (
    <div style={{ margin: "14px 0 8px" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ink)" }}>{txt}</div>
      <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{hint}</div>
    </div>
  );

  return (
    <>
      <Field
        label={isCoachViewer ? t("Новый комментарий тренера", "Тренердин жаңы комментарийи") : t("Новый комментарий", "Жаңы комментарий")}
        hint={isCoachViewer
          ? t("Виден менеджерам и вам. Родитель не видит — для него есть «Прогресс».", "Менеджерлерге жана сизге көрүнөт. Ата-эне көрбөйт.")
          : t("Болезни, особенности, договорённости. Комментарий видят все сотрудники, родитель — нет.", "Оорулар, өзгөчөлүктөр, макулдашуулар. Комментарийди бардык кызматкерлер көрөт, ата-эне көрбөйт.")}
      >
        <textarea
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("Например: аллергия на…, освобождён от…", "Мисалы: аллергия…, бошотулган…")}
        />
      </Field>
      <button
        className="btn btn--primary"
        onClick={submit}
        disabled={add.isPending || !text.trim()}
        style={{ marginBottom: 4 }}
      >
        <Icon name="plus" size={14} /> {add.isPending ? t("Сохраняем…", "Сакталууда…") : t("Добавить", "Кошуу")}
      </button>

      {isLoading ? (
        <div className="empty"><div className="empty__title">{t("Загрузка…", "Жүктөлүүдө…")}</div></div>
      ) : (
        <>
          {/* Комментарии администрации — видны всем сотрудникам (ТЗ §3.2). */}
          {sectionTitle(
            t("Комментарии администрации", "Администрациянын комментарийлери"),
            t("Видят все сотрудники: офис и тренеры ребёнка", "Бардык кызматкерлер көрөт: офис жана баланын тренерлери"),
          )}
          {officeComments.length === 0
            ? <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "4px 0 8px" }}>{t("Пока нет", "Азырынча жок")}</div>
            : renderList(officeComments)}
          {sectionTitle(
            t("Комментарии тренера", "Тренердин комментарийлери"),
            isCoachViewer
              ? t("Ваши заметки — видят менеджеры и вы", "Сиздин жазмаларыңыз")
              : t("Видят менеджеры и сам тренер, родитель — нет", "Менеджерлер жана тренер көрөт"),
          )}
          {coachComments.length === 0
            ? <div style={{ fontSize: 12.5, color: "var(--muted)", padding: "4px 0 8px" }}>{t("Пока нет", "Азырынча жок")}</div>
            : renderList(coachComments)}
        </>
      )}
    </>
  );
};

// ============================ Перс. тренировки (ПТ, §1) ============================
const PT_PKG_LBL: Record<string, { ru: string; ky: string; cls: string }> = {
  purchased: { ru: "Куплен (долг)", ky: "Сатылды (карыз)", cls: "debt" },
  awaiting_activation: { ru: "Ожидает активации", ky: "Активацияны күтөт", cls: "pending" },
  active: { ru: "Действующий", ky: "Активдүү", cls: "active" },
  completed: { ru: "Завершен", ky: "Аяктады", cls: "expired" },
  expired: { ru: "Истек срок", ky: "Мөөнөтү бүттү", cls: "expired" },
  blocked: { ru: "Заблокирован", ky: "Бөгөттөлгөн", cls: "frozen" },
  refunded: { ru: "Возвращен", ky: "Кайтарылды", cls: "archived" },
  annulled: { ru: "Аннулирован", ky: "Жокко чыгарылды", cls: "archived" },
};

const PT_VISIT_LBL: Record<string, { ru: string; ky: string }> = {
  scheduled: { ru: "Запланирована", ky: "Пландалган" },
  attended: { ru: "✓ Присутствовал", ky: "✓ Катышты" },
  missed: { ru: "Неявка", ky: "Келген жок" },
  cancelled: { ru: "Отмена", ky: "Жокко чыгарылды" },
  rescheduled: { ru: "Перенос", ky: "Которулду" },
};

const PtTab = ({ childId, role, lang }: { childId: string; role: Role; lang: Lang }) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { data: packages = [] } = usePtPackages({ child_id: childId });
  const { data: lessons = [] } = usePtLessonsForChild(childId);
  const { data: comments = [] } = usePtCoachComments(childId);
  const { data: coaches = [] } = useCoaches();
  const changeCoach = usePtChangeCoach();
  const [coachEditPkg, setCoachEditPkg] = useState<string | null>(null);
  const [newCoachId, setNewCoachId] = useState("");

  const fmtDT = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "—";

  return (
    <>
      {/* Пакеты: активный пакет, остаток, срок действия, тренер, кто продал */}
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>{t("Пакеты", "Пакеттер")}</div>
      {packages.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Пакетов нет", "Пакеттер жок")}</div></div>
      ) : (
        packages.map((p) => {
          const debt = Math.max(0, Number(p.price) - Number(p.paid));
          const lbl = PT_PKG_LBL[p.status] ?? PT_PKG_LBL.purchased;
          return (
            <div key={p.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div>
                  <b>{p.service?.name ?? "—"}</b>{" "}
                  <span className={`pill pill--${lbl.cls}`}>{lbl[lang]}</span>
                  {p.group_id && <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 6 }}>{t("мини-группа", "мини-топ")}</span>}
                </div>
                <div style={{ fontSize: 13 }}>
                  {t("Остаток", "Калдык")}: <b>{p.lessons_total - p.lessons_used}/{p.lessons_total}</b>
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span>{t("Цена", "Баасы")}: <b>{formatCurrency(Number(p.price))}</b></span>
                <span>{t("Оплачено", "Төлөндү")}: <b>{formatCurrency(Number(p.paid))}</b></span>
                {debt > 0 && <span style={{ color: "var(--red-600)" }}>{t("Долг", "Карыз")}: <b>{formatCurrency(debt)}</b></span>}
                {p.expires_at && <span>{t("Действует до", "Мөөнөтү")}: <b>{p.expires_at}</b></span>}
                {p.activation_deadline && !p.activated_at && (
                  <span>{t("Активировать до", "Активация чейин")}: <b>{p.activation_deadline}</b></span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <span>
                  {t("Тренер", "Тренер")}: <b>{p.coach?.full_name ?? "—"}</b>
                  {role === "admin" && (
                    coachEditPkg === p.id ? (
                      <span style={{ marginLeft: 6, display: "inline-flex", gap: 4 }}>
                        <select value={newCoachId} onChange={(e) => setNewCoachId(e.target.value)} style={{ fontSize: 12 }}>
                          <option value="">{t("— тренер —", "— тренер —")}</option>
                          {coaches.map((c: { id: string; full_name: string }) => (
                            <option key={c.id} value={c.id}>{c.full_name}</option>
                          ))}
                        </select>
                        <button
                          className="btn btn--primary"
                          style={{ padding: "2px 8px", fontSize: 11 }}
                          disabled={!newCoachId || changeCoach.isPending}
                          onClick={async () => {
                            await changeCoach.mutateAsync({ package_id: p.id, body: { coach_id: newCoachId } });
                            setCoachEditPkg(null);
                          }}
                        >
                          OK
                        </button>
                        <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setCoachEditPkg(null)}>×</button>
                      </span>
                    ) : (
                      <button
                        className="btn btn--ghost"
                        style={{ padding: "2px 8px", fontSize: 11, marginLeft: 6 }}
                        onClick={() => { setCoachEditPkg(p.id); setNewCoachId(p.coach_id); }}
                      >
                        {t("Сменить", "Алмаштыруу")}
                      </button>
                    )
                  )}
                </span>
                <span>{t("Продал(а)", "Саткан")}: <b>{p.seller?.full_name ?? "—"}</b></span>
                <span>{t("Куплен", "Сатылган")}: {new Date(p.sold_at).toLocaleDateString("ru-RU")}</span>
                {p.sold_in_debt && p.debt_comment && (
                  <span style={{ color: "var(--red-600)" }}>{t("Долг", "Карыз")}: {p.debt_comment}</span>
                )}
              </div>
            </div>
          );
        })
      )}

      {/* История посещений / переносов / отмен, время входа-выхода */}
      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 8px" }}>
        {t("История тренировок", "Машыгуу тарыхы")}
      </div>
      {lessons.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Тренировок не было", "Машыгуулар жок")}</div></div>
      ) : (
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t("Дата", "Күнү")}</th>
                <th>{t("Время", "Убакыт")}</th>
                <th>{t("Тренер", "Тренер")}</th>
                <th>{t("Статус", "Абалы")}</th>
                <th>{t("Вход / выход", "Кирүү / чыгуу")}</th>
                <th>{t("Причина", "Себеби")}</th>
              </tr>
            </thead>
            <tbody>
              {lessons.map((l) => {
                const s = l.session;
                const coachName =
                  coaches.find((c: { id: string }) => c.id === (s?.actual_coach_id ?? s?.coach_id))?.full_name ?? "—";
                const lbl = PT_VISIT_LBL[l.status] ?? PT_VISIT_LBL.scheduled;
                return (
                  <tr key={l.id}>
                    <td>{s ? new Date(s.date + "T00:00:00").toLocaleDateString("ru-RU") : "—"}</td>
                    <td>{s ? s.start_time.slice(0, 5) : "—"}</td>
                    <td>
                      {coachName}
                      {s?.actual_coach_id && <div style={{ fontSize: 10, color: "var(--blue)" }}>{t("по замене", "алмаштыруу")}</div>}
                    </td>
                    <td>
                      {lbl[lang]}
                      {l.status === "missed" && l.charged && <b style={{ color: "var(--red-600)" }}> · {t("Списано", "Алынды")}</b>}
                    </td>
                    <td>{l.entry_time || l.exit_time ? `${fmtDT(l.entry_time)} / ${fmtDT(l.exit_time)}` : "—"}</td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>
                      {l.cancel_reason ?? l.reschedule_reason ?? s?.cancel_reason ?? s?.reschedule_reason ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Комментарии тренера по итогам пакета (§16) */}
      <div style={{ fontWeight: 700, fontSize: 13, margin: "14px 0 8px" }}>
        {t("Комментарии тренера (каждые 10 тренировок)", "Тренердин комментарийлери")}
      </div>
      {comments.length === 0 ? (
        <div className="empty"><div className="empty__title">{t("Комментариев нет", "Комментарийлер жок")}</div></div>
      ) : (
        comments.map((c) => (
          <div key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10, marginBottom: 6 }}>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
              <b>{c.coach?.full_name ?? "—"}</b> · {t("после", "кийин")} {c.milestone} {t("тренировок", "машыгуудан")} ·{" "}
              {new Date(c.created_at).toLocaleDateString("ru-RU")}
            </div>
            <div style={{ fontSize: 13 }}>{c.text}</div>
          </div>
        ))
      )}
    </>
  );
};
