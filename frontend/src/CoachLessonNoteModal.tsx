import { useEffect, useState } from "react";
import { Modal, Field } from "./shared/ui/Modal";
import { Icon } from "./data";
import type { Lang } from "./data";
import {
  useLessonNotesForLesson,
  useSignedLessonNotePhoto,
} from "./shared/api/queries";
import { useUpsertLessonNote, useUploadLessonNotePhoto } from "./shared/api/mutations";
import { useAuth } from "./shared/auth/AuthProvider";

const MAX_PHOTOS = 3;

export const CoachLessonNoteModal = ({
  open, onClose, lang, lessonId, childId, childName,
}: {
  open: boolean;
  onClose: () => void;
  lang: Lang;
  lessonId: string;
  childId: string;
  childName: string;
}) => {
  const t = (ru: string, ky: string) => (lang === "ru" ? ru : ky);
  const { user } = useAuth();
  const { data: notes = [] } = useLessonNotesForLesson(lessonId);
  const upsert = useUpsertLessonNote();
  const upload = useUploadLessonNotePhoto();

  // Существующая заметка для этого ребёнка (тренер может редактировать)
  const existing = notes.find((n) => n.child_id === childId);

  const [text, setText] = useState("");
  const [photoPaths, setPhotoPaths] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText(existing?.text ?? "");
    setPhotoPaths(existing?.photo_paths ?? []);
    setErr(null);
  }, [open, existing?.id]);

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErr(null);
    const slots = Math.max(0, MAX_PHOTOS - photoPaths.length);
    if (slots <= 0) {
      setErr(t(`Можно прикрепить максимум ${MAX_PHOTOS} фото`, `Максимум ${MAX_PHOTOS} сүрөт`));
      return;
    }
    const list = Array.from(files).slice(0, slots);
    try {
      const paths: string[] = [];
      for (const file of list) {
        if (file.size > 5 * 1024 * 1024) {
          throw new Error(t("Файл больше 5MB", "Файл 5MBдан чоң"));
        }
        const path = await upload.mutateAsync({ lesson_id: lessonId, child_id: childId, file });
        paths.push(path);
      }
      setPhotoPaths((p) => [...p, ...paths].slice(0, MAX_PHOTOS));
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  };

  const removePhoto = (path: string) => {
    setPhotoPaths((p) => p.filter((x) => x !== path));
  };

  const submit = async () => {
    setErr(null);
    if (!user?.id) return;
    if (!text.trim()) {
      setErr(t("Текст заметки обязателен", "Заметка тексти милдеттүү"));
      return;
    }
    try {
      await upsert.mutateAsync({
        lesson_id: lessonId,
        child_id: childId,
        coach_id: user.id,
        text: text.trim(),
        photo_paths: photoPaths,
      });
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
    }
  };

  const busy = upsert.isPending || upload.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${t("Заметка о занятии", "Сабак тууралуу")} · ${childName}`}
    >
      <Field label={t("Текст (обязательно)", "Текст (милдеттүү)")}>
        <textarea
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={1000}
          placeholder={t(
            "Сегодня делали кувырки, у Айдара получилось чисто…",
            "Бүгүн жасадык…",
          )}
          disabled={busy}
        />
      </Field>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
          {t("Фото (до 3, опционально)", "Сүрөт (3ке чейин)")}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {photoPaths.map((p) => (
            <PhotoThumb key={p} path={p} onRemove={() => removePhoto(p)} busy={busy} />
          ))}
          {photoPaths.length < MAX_PHOTOS && (
            <label className="btn" style={{ cursor: busy ? "wait" : "pointer", borderStyle: "dashed", minHeight: 72, minWidth: 72, display: "grid", placeItems: "center" }}>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                style={{ display: "none" }}
                onChange={(e) => onPickFiles(e.target.files)}
                disabled={busy}
              />
              {upload.isPending ? "…" : <Icon name="plus" size={20} />}
            </label>
          )}
        </div>
      </div>

      {err && <div className="field__error" style={{ marginTop: 8 }}>{err}</div>}

      <div className="modal__foot">
        <button className="btn" onClick={onClose} disabled={busy}>
          {t("Отмена", "Жокко чыгаруу")}
        </button>
        <button
          className="btn btn--primary"
          onClick={submit}
          disabled={busy || !text.trim()}
        >
          {busy ? t("Сохраняем…", "Сакталууда…") : t("Сохранить", "Сактоо")}
        </button>
      </div>
    </Modal>
  );
};

const PhotoThumb = ({ path, onRemove, busy }: { path: string; onRemove: () => void; busy: boolean }) => {
  const { data: url } = useSignedLessonNotePhoto(path);
  return (
    <div style={{ position: "relative", width: 72, height: 72 }}>
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            width: 72, height: 72, objectFit: "cover",
            borderRadius: "var(--r-sm)", border: "1px solid var(--line)",
          }}
        />
      ) : (
        <div style={{
          width: 72, height: 72, background: "var(--bg-soft)",
          borderRadius: "var(--r-sm)", display: "grid", placeItems: "center",
          color: "var(--muted)", fontSize: 11,
        }}>…</div>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        title="Удалить"
        style={{
          position: "absolute", top: -6, right: -6,
          width: 22, height: 22, borderRadius: "50%",
          background: "var(--red-600)", color: "#fff", border: "2px solid #fff",
          display: "grid", placeItems: "center", cursor: busy ? "wait" : "pointer",
        }}
      >
        <Icon name="x" size={11} stroke={2.5} />
      </button>
    </div>
  );
};
