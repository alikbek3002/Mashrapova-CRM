import { useMemo, useState } from "react";
import { Icon } from "../data";
import type { Lang } from "../data";
import { PageHeader, SearchBox, EmptyState, initialsOf } from "./common";
import { useFamilies } from "../shared/api/queries";
import { AddFamilyModal } from "../shared/ui/forms";
import { Gate } from "../shared/auth/Gate";
import { SkeletonRows, SkeletonText } from "../shared/ui/Skeleton";

export const ParentsPage = ({ lang }: { lang: Lang }) => {
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const { data: families = [], isLoading, error } = useFamilies();
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const editing = families.find((f) => f.id === editId);

  const rows = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return families;
    return families.filter((p) => {
      const blob = [p.father_name, p.mother_name, p.father_phone, p.mother_phone].filter(Boolean).join(" ").toLowerCase();
      return blob.includes(qq);
    });
  }, [q, families]);

  return (
    <>
      <PageHeader
        title={t("Родители", "Ата-энелер")}
        subtitle={isLoading ? <SkeletonText /> : t(`${families.length} семей в базе`, `${families.length} үй-бүлө`)}
        actions={
          <Gate perm="edit_parents">
            <button className="btn btn--primary" onClick={() => setAddOpen(true)}>
              <Icon name="plus" /> {t("Добавить семью", "Үй-бүлө кошуу")}
            </button>
          </Gate>
        }
      />

      <AddFamilyModal open={addOpen} onClose={() => setAddOpen(false)} lang={lang} />
      {editing && (
        <AddFamilyModal
          open={!!editId}
          onClose={() => setEditId(null)}
          lang={lang}
          initial={{
            id: editing.id,
            father_name: editing.father_name,
            father_phone: editing.father_phone,
            mother_name: editing.mother_name,
            mother_phone: editing.mother_phone,
            comment: editing.comment,
            parent_user_id: editing.parent_user_id,
            responsible_manager_id: editing.responsible_manager_id ?? null,
          }}
        />
      )}

      <div className="card">
        <div className="toolbar">
          <SearchBox value={q} onChange={setQ} placeholder={t("Поиск по имени, телефону…", "Аты, телефон боюнча…")} />
        </div>
        {error ? (
          <EmptyState title={t("Ошибка загрузки", "Жүктөө катасы")} hint={error.message} />
        ) : isLoading ? (
          <SkeletonRows />
        ) : rows.length === 0 ? (
          <EmptyState title={t("Никто не найден", "Эч ким табылган жок")} />
        ) : (
          <div className="table-scroll">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t("Отец", "Атасы")}</th>
                  <th>{t("Мать", "Энеси")}</th>
                  <th>{t("Телефоны", "Телефондор")}</th>
                  <th>{t("Комментарий", "Комментарий")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} onClick={() => setEditId(p.id)}>
                    <td>
                      {p.father_name ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="call-row__avatar" style={{ width: 32, height: 32, fontSize: 11 }}>
                            {initialsOf(p.father_name)}
                          </div>
                          <div className="cell-main">{p.father_name}</div>
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted-2)" }}>—</span>
                      )}
                    </td>
                    <td>
                      {p.mother_name ? (
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div className="call-row__avatar" style={{ width: 32, height: 32, fontSize: 11, background: "var(--yellow-100)", color: "var(--yellow-ink)" }}>
                            {initialsOf(p.mother_name)}
                          </div>
                          <div className="cell-main">{p.mother_name}</div>
                        </div>
                      ) : (
                        <span style={{ color: "var(--muted-2)" }}>—</span>
                      )}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
                      {p.father_phone && <div>{p.father_phone}</div>}
                      {p.mother_phone && <div>{p.mother_phone}</div>}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{p.comment ?? "—"}</td>
                    <td style={{ textAlign: "right", width: 1 }}>
                      <div style={{ display: "flex", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const phone = p.father_phone || p.mother_phone;
                          if (!phone) return <span style={{ fontSize: 11, color: "var(--muted-2)" }}>—</span>;
                          const wa = phone.replace(/[^0-9]/g, "");
                          return (
                            <>
                              <a className="icon-btn" title="WhatsApp" href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer">
                                <Icon name="whatsapp" />
                              </a>
                              <a className="icon-btn" title="Call" href={`tel:${phone}`}>
                                <Icon name="phone" />
                              </a>
                            </>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
