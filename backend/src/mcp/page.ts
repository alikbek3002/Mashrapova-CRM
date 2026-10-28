// Страница входа при подключении CRM к Claude или ChatGPT.
// Фирменный стиль по брендбуку: красный #F10000, чёрный, серый, белый,
// знак «М»; заголовок — Inter Tight heavy italic, как на сайте.

type Params = Record<string, string | undefined>;

export type LoginView =
  | { step: "login"; params: Params; clientName?: string; phone?: string; error?: string }
  | { step: "mfa"; nonce: string; params: Params; name?: string; error?: string }
  | { step: "error"; error: string };

const esc = (s: string | undefined) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const MARK = `<svg viewBox="0 0 122.6 122.6" aria-hidden="true"><g transform="translate(0 0.1)" fill="#F10000" fill-rule="evenodd"><path d="M35 122.3C35.3 114.3 35.1 106 35.1 97.9C35.1 95.1 35.6 94.6 33.8 93.1C29.6 89.8 25.2 85.6 20.3 81.7C18.7 80.4 19.3 79.3 19.3 76.7C19.3 65.4 18.9 50.1 19.3 39.6C20.9 40.4 38.9 55.6 40.8 57.1L56.7 70.5C58.6 72.1 60.3 73.5 62.1 75C63.6 74.3 70.5 68 72.8 66.2C74.6 64.8 76.1 63.2 77.9 61.8L104.4 39.6L104.4 80.8L100.9 84.1C98.9 85.8 90.2 92.9 89.5 94.1C88.7 95.4 89 119 89.3 122.3C90.5 121.7 92.3 119.8 93.2 119L105.8 108.1C107 107 108.6 105.8 109.9 104.7C110.9 103.8 111 103.6 111.9 102.9C114.5 100.9 119.1 96.2 122.6 93.9L122.6 0C121.6 0.3 100.9 17.9 98.7 19.8C97.3 20.9 96.6 21.7 95.2 22.8L75 40.1C73.4 41.5 69.2 44.5 68.2 46C69.6 47.9 72.2 48.9 73.5 50.8C73 51.9 73.5 51.3 72.4 52.1C71.6 52.7 71.7 52.5 70.8 53.3C69.9 54.2 69.2 55 67.9 55.7C66.6 54.8 64.8 53.3 63.7 52.3L51 41.8C43 35.3 33.4 26.8 25.8 20.9L17.6 13.8C15.6 12.2 2.9 1.2 0.9 0.1C0.5 5.9 0.9 31.4 0.9 39.2L0.9 88C0.9 93 0 93 3.1 95.5C6.1 98 33.3 121.6 35 122.3Z"/><path d="M62.5 105.7C68.3 100.4 73.8 96.3 79.2 91.4L96.2 77.2L96.3 55.5C94.9 56.1 93.2 57.8 92 58.8L66.4 80.3C65.1 81.3 63.5 83.1 62.2 83.7C59.3 81.5 56.5 79 53.7 76.7C50.3 73.8 29.5 55.8 27.9 55.7C27.8 58.9 27.4 74.5 27.9 76.6C28.2 77.6 49.1 94.9 50.6 96.1C52.2 97.6 61.2 105.1 62.5 105.7Z"/></g></svg>`;

const hidden = (p: Params) =>
  Object.entries(p)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join("");

const appName = (n?: string) => {
  if (!n) return "Ассистент";
  if (/claude/i.test(n)) return "Claude";
  if (/chatgpt|openai/i.test(n)) return "ChatGPT";
  return n;
};

const body = (v: LoginView) => {
  if (v.step === "error") {
    return `<h1>Не получилось</h1><p class="lead">${esc(v.error)}</p>`;
  }
  const err = v.error ? `<div class="err" role="alert">${esc(v.error)}</div>` : "";
  if (v.step === "mfa") {
    return `
      <h1>Код 2FA</h1>
      <p class="lead">${v.name ? `${esc(v.name)}, в` : "В"}ведите шестизначный код из приложения-аутентификатора.</p>
      ${err}
      <form method="post" action="/oauth/authorize" autocomplete="off">
        <input type="hidden" name="mfa_nonce" value="${esc(v.nonce)}">
        <label>Код<input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus placeholder="000000" class="code"></label>
        <button type="submit">Подтвердить</button>
      </form>`;
  }
  const who = appName(v.clientName);
  return `
    <h1>Доступ к CRM</h1>
    <p class="lead"><b>${esc(who)}</b> просит доступ к CRM Академии Машрапова. Он сможет смотреть и менять данные от вашего имени — с вашими правами.</p>
    <ul class="can">
      <li>Лиды, воронка и KPI менеджеров</li>
      <li>Клиенты, абонементы, должники, оплаты</li>
      <li>Новые клиенты, оплаты, продажа абонементов — только после вашего подтверждения в чате</li>
    </ul>
    ${err}
    <form method="post" action="/oauth/authorize">
      ${hidden(v.params)}
      <label>Телефон<input name="phone" type="tel" inputmode="tel" autocomplete="username" required placeholder="+996 700 000 000" value="${esc(v.phone)}" ${v.phone ? "" : "autofocus"}></label>
      <label>Пароль<input name="password" type="password" autocomplete="current-password" required ${v.phone ? "autofocus" : ""}></label>
      <button type="submit">Разрешить доступ</button>
    </form>
    <p class="note">Только для директора и старшего менеджера. Отключить доступ можно в настройках ${esc(who)}.</p>`;
};

export const loginPage = (v: LoginView) => `<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Вход · CRM Машрапова</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Inter+Tight:ital,wght@1,900&display=swap" rel="stylesheet">
<style>
  :root { --brand:#F10000; --brand-600:#D00000; --ink:#0B0B0B; --muted:#6B6B6B; --line:#E4E4E4; --bg:#F4F4F4; --surface:#FFF; }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink);
         font:15px/1.5 Inter, system-ui, -apple-system, sans-serif; padding:16px; }
  .card { width:100%; max-width:420px; background:var(--surface); border-radius:14px; overflow:hidden;
          box-shadow:0 1px 2px rgba(0,0,0,.06), 0 12px 40px rgba(0,0,0,.08); }
  .top { background:#000; color:#fff; padding:22px 28px; display:flex; align-items:center; gap:14px; }
  .top svg { width:40px; height:40px; flex:none; }
  .word { font:italic 900 22px/1 "Inter Tight", Inter, sans-serif; letter-spacing:.02em; text-transform:uppercase; }
  .sub { font-size:12px; color:#B0B0B0; margin-top:4px; letter-spacing:.04em; text-transform:uppercase; }
  .in { padding:26px 28px 28px; }
  h1 { font:italic 900 26px/1.1 "Inter Tight", Inter, sans-serif; text-transform:uppercase; margin:0 0 10px; }
  .lead { margin:0 0 14px; color:#333; }
  .can { margin:0 0 18px; padding:12px 14px 12px 30px; background:#FAFAFA; border:1px solid var(--line); border-radius:8px; color:#333; font-size:14px; }
  .can li { margin:3px 0; } .can li::marker { color:var(--brand); }
  label { display:block; font-size:13px; font-weight:600; color:var(--muted); margin:0 0 14px; }
  input { display:block; width:100%; margin-top:6px; padding:12px 14px; font:inherit; font-size:16px; color:var(--ink);
          border:1px solid var(--line); border-radius:8px; background:#fff; outline:none; transition:border-color .15s, box-shadow .15s; }
  input:focus { border-color:var(--brand); box-shadow:0 0 0 3px rgba(241,0,0,.12); }
  .code { letter-spacing:.5em; text-align:center; font:600 22px/1 "JetBrains Mono", ui-monospace, monospace; }
  button { width:100%; margin-top:6px; padding:13px 16px; border:0; border-radius:8px; background:var(--brand); color:#fff;
           font:700 15px/1 Inter, sans-serif; letter-spacing:.02em; cursor:pointer; transition:background .15s; }
  button:hover { background:var(--brand-600); }
  .err { margin:0 0 14px; padding:10px 12px; border-radius:8px; background:#FFF0F0; border:1px solid #FFD0D0; color:#B00000; font-size:14px; }
  .note { margin:16px 0 0; font-size:12px; color:var(--muted); }
</style></head>
<body><main class="card">
  <div class="top">${MARK}<div><div class="word">Машрапов</div><div class="sub">CRM · подключение ассистента</div></div></div>
  <div class="in">${body(v)}</div>
</main></body></html>`;
