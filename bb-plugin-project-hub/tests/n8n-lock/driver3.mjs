const HERE = new URL(".", import.meta.url).pathname;
const WORKER = HERE + ".gen/worker.ts";
const VICTIM = HERE + ".gen/victim.ts";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
// STRESS3: live holder blocks everyone; clean exit frees the lock (signal-exit)
const dir = fs.mkdtempSync(os.tmpdir() + "/pl-stress3-");
const held = dir + "/held";
const victim = spawn(process.execPath, ["--experimental-strip-types", VICTIM, dir, held], { stdio: "ignore",
  env: { ...process.env, N8N_LOCK_STALE_MS: "2000", N8N_LOCK_UPDATE_MS: "1000" } });
for (let i = 0; i < 50 && !fs.existsSync(held); i++) await new Promise((r) => setTimeout(r, 100));
const logFile = dir + "/holds.log";
fs.writeFileSync(logFile, "");
const w1 = spawn(process.execPath, ["--experimental-strip-types", WORKER, dir, logFile], { stdio: "ignore",
  env: { ...process.env, N8N_LOCK_STALE_MS: "2000", N8N_LOCK_UPDATE_MS: "1000" } });
await new Promise((r) => setTimeout(r, 1500));
const early = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter((l) => l.startsWith("BEGIN")).length;
victim.kill("SIGTERM"); // clean exit -> proper-lockfile signal-exit removes the dir
await new Promise((res) => victim.on("exit", res));
await new Promise((res) => w1.on("exit", res));
const total = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter((l) => l.startsWith("BEGIN")).length;
console.log(`while held: ${early}, after clean exit: ${total}`);
console.log(early === 0 && total >= 5 ? "STRESS3 PASS: live holder blocks, clean exit frees" : "STRESS3 FAIL");
process.exit(early === 0 && total >= 5 ? 0 : 1);
