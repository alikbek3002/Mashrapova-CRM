// Поднимает локальный Postgres из npm-пакета: без Docker и без прав
// администратора. Слушает TCP — unix-сокет не используется, потому что
// путь к каталогу проекта легко превышает лимит длины сокета в macOS.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const BIN = "node_modules/@embedded-postgres/darwin-arm64/native/bin";
const DATA = "pgdata";

if (existsSync(DATA)) rmSync(DATA, { recursive: true, force: true });
execFileSync(`${BIN}/initdb`, ["-D", DATA, "-U", "postgres", "--auth=trust", "-E", "UTF8"], { stdio: "ignore" });
execFileSync(`${BIN}/pg_ctl`, [
  "-D", DATA,
  "-o", "-h 127.0.0.1 -p 55432 -c unix_socket_directories=''",
  "-l", "pg.log", "start",
], { stdio: "inherit" });
console.log("Postgres слушает 127.0.0.1:55432");
