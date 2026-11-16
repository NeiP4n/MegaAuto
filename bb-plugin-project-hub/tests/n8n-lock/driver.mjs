const HERE = new URL(".", import.meta.url).pathname;
const WORKER = HERE + ".gen/worker.ts";
const VICTIM = HERE + ".gen/victim.ts";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
// STRESS1: 6 workers, 2 randomly SIGKILLed mid-run -> zero double owners
const dir = fs.mkdtempSync(os.tmpdir() + "/pl-stress-");
const logFile = dir + "/holds.log";
fs.writeFileSync(logFile, "");
const workers = [];
for (let i = 0; i < 6; i++) {
  workers.push(spawn(process.execPath, ["--experimental-strip-types", WORKER, dir, logFile], { stdio: "ignore",
    env: { ...process.env, N8N_LOCK_STALE_MS: "2000", N8N_LOCK_UPDATE_MS: "1000" } }));
}
await new Promise((r) => setTimeout(r, 400));
const killedPids = new Set();
for (const idx of [1, 4]) {
  const w = workers[idx];
  if (w.pid && w.exitCode === null) { killedPids.add(w.pid); w.kill("SIGKILL"); }
}
await Promise.all(workers.map((w) => new Promise((res) => w.on("exit", res))));
const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
let openPid = null, violations = 0;
for (const line of lines) {
  const [kind, pidS] = line.split(" ");
  const pid = Number(pidS);
  if (kind === "BEGIN") {
    if (openPid !== null && !killedPids.has(openPid)) { console.error(`VIOLATION: BEGIN ${pid} while ${openPid} holds`); violations++; }
    openPid = pid;
  } else {
    if (openPid !== pid) { console.error(`VIOLATION: END ${pid} but holder is ${openPid}`); violations++; }
    openPid = null;
  }
}
const begins = lines.filter((l) => l.startsWith("BEGIN")).length;
console.log(`holds: ${begins}`);
console.log(violations === 0 && begins >= 3 ? "STRESS PASS: single live owner at all times" : "STRESS FAIL");
process.exit(violations === 0 && begins >= 3 ? 0 : 1);
