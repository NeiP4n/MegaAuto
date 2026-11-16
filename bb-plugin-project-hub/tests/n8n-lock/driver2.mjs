const HERE = new URL(".", import.meta.url).pathname;
const WORKER = HERE + ".gen/worker.ts";
const VICTIM = HERE + ".gen/victim.ts";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
// STRESS2: holder SIGKILLed mid-hold -> stale recovery by another process
const dir = fs.mkdtempSync(os.tmpdir() + "/pl-stress2-");
const held = dir + "/held";
const victim = spawn(process.execPath, ["--experimental-strip-types", VICTIM, dir, held], { stdio: "ignore",
  env: { ...process.env, N8N_LOCK_STALE_MS: "2000", N8N_LOCK_UPDATE_MS: "1000" } });
for (let i = 0; i < 50 && !fs.existsSync(held); i++) await new Promise((r) => setTimeout(r, 100));
if (!fs.existsSync(held)) { console.log("STRESS2 FAIL: victim never acquired"); process.exit(1); }
victim.kill("SIGKILL");
const logFile = dir + "/holds.log";
fs.writeFileSync(logFile, "");
const worker = spawn(process.execPath, ["--experimental-strip-types", WORKER, dir, logFile], { stdio: "ignore",
  env: { ...process.env, N8N_LOCK_STALE_MS: "2000", N8N_LOCK_UPDATE_MS: "1000" } });
await new Promise((res) => worker.on("exit", res));
const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
const begins = lines.filter((l) => l.startsWith("BEGIN")).length;
console.log(`holds after kill: ${begins}`);
console.log(begins >= 5 ? "STRESS2 PASS: stale lock of killed owner reclaimed" : "STRESS2 FAIL");
process.exit(begins >= 5 ? 0 : 1);
