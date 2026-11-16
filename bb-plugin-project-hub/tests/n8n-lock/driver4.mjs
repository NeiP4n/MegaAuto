const HERE = new URL(".", import.meta.url).pathname;
const WORKER = HERE + ".gen/worker.ts";
const VICTIM = HERE + ".gen/victim.ts";
import { spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
// STRESS4: aggressor plants backdated stale lock dirs while 6 workers race
const dir = fs.mkdtempSync(os.tmpdir() + "/pl-stress4-");
const logFile = dir + "/holds.log";
fs.writeFileSync(logFile, "");
const lockDir = dir + "/n8n.lock.lock";
let stop = false;
const aggressor = setInterval(() => {
  if (stop) return;
  try {
    fs.mkdirSync(lockDir);
    const old = new Date(Date.now() - 3600_000);
    fs.utimesSync(lockDir, old, old);
  } catch {}
}, 40);
const workers = [];
for (let i = 0; i < 6; i++) {
  workers.push(spawn(process.execPath, ["--experimental-strip-types", WORKER, dir, logFile], { stdio: "ignore",
    env: { ...process.env, N8N_LOCK_STALE_MS: "2000", N8N_LOCK_UPDATE_MS: "1000" } }));
}
await Promise.all(workers.map((w) => new Promise((res) => w.on("exit", res))));
stop = true; clearInterval(aggressor);
try { fs.rmdirSync(lockDir); } catch {}
const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n").filter(Boolean);
let openPid = null, violations = 0;
for (const line of lines) {
  const [kind, pidS] = line.split(" ");
  const pid = Number(pidS);
  if (kind === "BEGIN") {
    if (openPid !== null) { console.error(`VIOLATION: BEGIN ${pid} while ${openPid} holds`); violations++; }
    openPid = pid;
  } else {
    if (openPid !== pid) { console.error(`VIOLATION: END ${pid} but holder is ${openPid}`); violations++; }
    openPid = null;
  }
}
const begins = lines.filter((l) => l.startsWith("BEGIN")).length;
console.log(`holds: ${begins}`);
console.log(violations === 0 && begins >= 5 ? "STRESS4 PASS: stale plants vs concurrent acquire, single owner" : "STRESS4 FAIL");
process.exit(violations === 0 && begins >= 5 ? 0 : 1);
