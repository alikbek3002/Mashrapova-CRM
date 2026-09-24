import { execFileSync } from "node:child_process";
execFileSync("node_modules/@embedded-postgres/darwin-arm64/native/bin/pg_ctl",
  ["-D", "pgdata", "stop", "-m", "fast"], { stdio: "inherit" });
