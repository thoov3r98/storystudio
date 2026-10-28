import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

export default function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("Set E2E_DATABASE_URL to a disposable, migrated test database.");
  const out = execFileSync("pnpm", ["tsx", "tests/e2e/seed.ts"], {
    env: { ...process.env, DATABASE_URL: url, ALLOW_E2E_SEED: "1" },
    encoding: "utf8",
  });
  const ids = out.trim().split("\n").at(-1)!;
  writeFileSync(path.join(__dirname, ".seed.json"), ids);
}
