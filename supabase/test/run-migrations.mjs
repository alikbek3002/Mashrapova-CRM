// Прогон всех миграций проекта на локальном Postgres.
// Цель — поймать ошибки выполнения: типы, порядок зависимостей,
// конфликты имён. Поведение Supabase здесь не воспроизводится.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const DIR = process.argv[2];
const conn = { host: "127.0.0.1", port: 55432, user: "postgres", database: "postgres" };

const client = new pg.Client(conn);
await client.connect();

await client.query(readFileSync("setup.sql", "utf8"));
console.log("Заглушки Supabase созданы\n");

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
let ok = 0;
const failures = [];

for (const f of files) {
  const sql = readFileSync(`${DIR}/${f}`, "utf8");
  try {
    await client.query(sql);
    ok++;
    process.stdout.write(".");
  } catch (e) {
    failures.push({ file: f, message: e.message, detail: e.detail, hint: e.hint, position: e.position });
    process.stdout.write("x");
    // Продолжаем: последующие миграции могут опираться на эту, но лучше
    // увидеть все проблемы разом, чем чинить по одной.
  }
}

console.log(`\n\nУспешно: ${ok} из ${files.length}`);
if (failures.length) {
  console.log(`\nОШИБКИ (${failures.length}):`);
  for (const x of failures) {
    console.log(`\n── ${x.file}`);
    console.log(`   ${x.message}`);
    if (x.detail) console.log(`   detail: ${x.detail}`);
    if (x.hint) console.log(`   hint: ${x.hint}`);
  }
}
await client.end();
process.exit(failures.length ? 1 : 0);
