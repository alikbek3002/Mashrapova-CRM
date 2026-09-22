// Аватар ребёнка: показывает фото (children.photo_path) или инициалы.
// ChildAvatar — только отображение (для списков, без хуков).
// EditableChildAvatar — с кнопкой «сфотать/загрузить» (карточка ребёнка, родитель).
import { useRef } from "react";
import type { ChangeEvent, CSSProperties } from "react";
import { Icon } from "../../data";
import { resolveChildPhotoUrl } from "../api/avatar";
import { useUploadChildPhoto } from "../api/mutations";

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0] ?? "").join("").slice(0, 2).toUpperCase();

const imgStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  borderRadius: "inherit",
};

export const ChildAvatar = ({
  photoPath, fullName, className, style, onClick,
}: {
  photoPath?: string | null;
  fullName: string;
  className: string;
  style?: CSSProperties;
  onClick?: () => void;
}) => {
  const url = resolveChildPhotoUrl(photoPath);
  return (
    <div className={className} style={{ position: "relative", overflow: "hidden", ...style }} onClick={onClick}>
      {url ? (
        <img
          src={url}
          alt=""
          style={imgStyle}
          onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        initialsOf(fullName)
      )}
    </div>
  );
};

export const EditableChildAvatar = ({
  childId, photoPath, fullName, className, canEdit, style,
}: {
  childId: string;
  photoPath?: string | null;
  fullName: string;
  className: string;
  canEdit: boolean;
  style?: CSSProperties;
}) => {
  const upload = useUploadChildPhoto();
  const inputRef = useRef<HTMLInputElement>(null);

  if (!canEdit) {
    return <ChildAvatar photoPath={photoPath} fullName={fullName} className={className} style={style} />;
  }

  const onPick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try { await upload.mutateAsync({ childId, file }); } catch { /* toast уже показан */ }
  };

  return (
    <div style={{ position: "relative", display: "inline-grid", placeItems: "center" }}>
      <ChildAvatar photoPath={photoPath} fullName={fullName} className={className} style={style} />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); inputRef.current?.click(); }}
        disabled={upload.isPending}
        title="Фото / Сүрөт"
        style={{
          position: "absolute", right: -2, bottom: -2, zIndex: 2,
          width: 22, height: 22, borderRadius: "50%",
          display: "grid", placeItems: "center", padding: 0,
          background: "var(--blue)", color: "#fff",
          border: "2px solid var(--surface)", cursor: "pointer",
        }}
      >
        <Icon name={upload.isPending ? "clock" : "download"} size={11} stroke={2.5} />
      </button>
      {/* accept без capture — мобильный сам предложит камеру ИЛИ галерею. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onPick}
        style={{ display: "none" }}
      />
    </div>
  );
};
