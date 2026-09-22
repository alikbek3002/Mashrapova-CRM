import { useState } from "react";
import { Icon } from "../../data";
import type { Lang } from "../../data";
import { Modal, Field } from "./Modal";

// Большой явный модал-подтверждение для смены пароля. Toast в углу
// слишком быстро исчезает — для смены пароля важно видеть подтверждение
// и иметь возможность скопировать новый пароль, чтобы передать его.
export const PasswordChangedDialog = ({
  open,
  onClose,
  lang,
  password,
  who,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  password: string;
  who?: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Браузер может запретить clipboard — оставляем пароль в поле,
      // пользователь сможет выделить и скопировать вручную.
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={440}
      title={t("Пароль успешно изменён", "Сырсөз ийгиликтүү өзгөртүлдү")}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "var(--green-50)",
          color: "var(--green)",
          border: "1px solid oklch(0.85 0.16 150)",
          borderRadius: "var(--r-sm)",
          marginBottom: 14,
          fontWeight: 500,
        }}
      >
        <Icon name="check" size={18} />
        <span>
          {who
            ? t(`Пароль обновлён для: ${who}`, `Сырсөз жаңыланды: ${who}`)
            : t("Пароль обновлён", "Сырсөз жаңыланды")}
        </span>
      </div>

      <Field
        label={t("Новый пароль", "Жаңы сырсөз")}
        hint={t(
          "Передайте этот пароль пользователю лично. Система не отправляет уведомлений.",
          "Бул сырсөздү колдонуучуга жеке өзүңүз бериңиз. Система кабарлама жибербейт.",
        )}
      >
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="text"
            readOnly
            value={password}
            style={{ flex: 1, fontFamily: "var(--font-mono)" }}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn"
            onClick={copy}
            style={{ minWidth: 110 }}
          >
            <Icon name={copied ? "check" : "download"} size={14} />
            {copied ? t("Скопировано", "Көчүрүлдү") : t("Копировать", "Көчүрүү")}
          </button>
        </div>
      </Field>

      <div className="modal__foot">
        <button className="btn btn--primary" onClick={onClose}>
          {t("Готово", "Даяр")}
        </button>
      </div>
    </Modal>
  );
};
