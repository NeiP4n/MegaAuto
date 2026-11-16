// ---- unit tests ----
import * as os from "os";
let passed = 0, failed = 0;
function ok(cond: boolean, name: string) { if (cond) { passed++; console.log("PASS", name); } else { failed++; console.log("FAIL", name); } }
function freshDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pl-unit-"));
  n8nLockFile = path.join(d, "n8n.lock");
  managerLockRelease = null; managerLockCompromised = null;
  ownManagerLockRecord = null; ownChildLockRecord = null;
  lastCompromisedStop = null;
  return d;
}
const LOCKDIR = () => `${n8nLockFile}.lock`;

// 1. acquire writes the manager record and creates the lock dir
freshDir();
{
  const r = acquireN8nManagerLock();
  ok(r.ok === true && fs.existsSync(LOCKDIR()), "acquire creates lock dir");
  const rec = readN8nLock();
  ok(!!rec && rec.pid === process.pid && rec.manager === true, "manager record written");
}

// 2. re-entrant acquire in the same process
{
  const r = acquireN8nManagerLock();
  ok(r.ok === true, "re-entrant acquire ok");
}

// 3. release removes record + dir; re-acquire works
{
  releaseN8nLock(process.pid);
  ok(!fs.existsSync(LOCKDIR()) && !fs.existsSync(n8nLockFile!), "release removes dir and record");
  const r = acquireN8nManagerLock();
  ok(r.ok === true, "re-acquire after release");
  releaseN8nLock(process.pid);
}

// 4. busy: another live process holding the lock -> honest ok:false
freshDir();
{
  fs.mkdirSync(LOCKDIR()); // fresh foreign lock (mtime = now); heartbeat not needed for the check
  const r = acquireN8nManagerLock();
  ok(r.ok === false && /занят|уже|отменён/i.test((r as any).reason || ""), "busy lock -> honest ok:false");
  fs.rmdirSync(LOCKDIR());
}

// 5. stale takeover: backdated lock dir is reclaimed without the port path
freshDir();
{
  fs.mkdirSync(LOCKDIR());
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(LOCKDIR(), old, old);
  const r = acquireN8nManagerLock();
  ok(r.ok === true && fs.existsSync(LOCKDIR()), "stale lock reclaimed");
  releaseN8nLock(process.pid);
}

// 6. crash recovery is proper-lockfile's stale path: covered by 5 + stress; here: record survives crash (no release)
//    (multi-process SIGKILL case is in the stress suite)

// 7. writeN8nLock CAS: only while holding; expected must match
freshDir();
{
  const w = writeN8nLock({ pid: 1, manager: false, createdAt: "x" });
  ok(w === false, "write refused without holding the lock");
  acquireN8nManagerLock();
  const rec = readN8nLock()!;
  const childRec = { pid: 424242, manager: false, createdAt: "c1" };
  ok(writeN8nLock(childRec, { pid: 999, manager: true, createdAt: "wrong" }) === false, "CAS mismatch refused");
  ok(readN8nLock()!.pid === rec.pid, "record untouched after refused CAS");
  ok(writeN8nLock(childRec, ownManagerLockRecord) === true && readN8nLock()!.pid === 424242, "CAS match writes child record");
  releaseN8nLock(424242);
}

// 8. releaseN8nLock does not delete a foreign record
freshDir();
{
  acquireN8nManagerLock();
  fs.writeFileSync(n8nLockFile!, JSON.stringify({ pid: 777, manager: false, createdAt: "foreign" }), "utf-8");
  releaseN8nLock(777);
  ok(fs.existsSync(n8nLockFile!), "foreign record kept on release");
  releaseN8nLock(process.pid);
}

// 9. cross-version guard: old-format record with a LIVE foreign pid blocks the start and the lock is released
freshDir();
{
  fs.writeFileSync(n8nLockFile!, JSON.stringify({ pid: 1, manager: true, createdAt: "old" }), "utf-8"); // pid 1 alive in the container
  const r = acquireN8nManagerLock();
  ok(r.ok === false && !fs.existsSync(LOCKDIR()), "live foreign old-format record blocks acquire, lock dir released");
}

// 10. REGRESSION (blocker 1): A holds a fresh lock with n8n not yet on
//     the port -> B must NOT break it: honest busy, the dir untouched.
freshDir();
{
  fs.mkdirSync(LOCKDIR()); // fresh foreign lock (A mid-start)
  process.env.TEST_PORT_STATE = "free";
  const r = acquireN8nManagerLock();
  process.env.TEST_PORT_STATE = "occupied";
  ok(r.ok === false && /занят|уже/i.test((r as any).reason || ""), "A holds, port free -> B busy, no start");
  ok(fs.existsSync(LOCKDIR()), "fresh foreign lock dir NOT removed");
  fs.rmdirSync(LOCKDIR());
}

// 11. unknown port state -> same honest busy (ELOCKED never probes the port)
freshDir();
{
  fs.mkdirSync(LOCKDIR());
  process.env.TEST_PORT_STATE = "unknown";
  const r = acquireN8nManagerLock();
  process.env.TEST_PORT_STATE = "occupied";
  ok(r.ok === false && fs.existsSync(LOCKDIR()), "unknown port -> busy, dir untouched");
  fs.rmdirSync(LOCKDIR());
}

// 12. compromised lock -> onCompromised fires, our child is stopped, further starts refused
{
  const d = freshDir();
  const r = acquireN8nManagerLock();
  ok(r.ok === true, "pre-compromise acquire ok");
  localN8nProcess = spawn("sleep", ["30"]); // stands in for our managed n8n
  fs.rmdirSync(LOCKDIR()); // external interference: our heartbeat will fail
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && managerLockCompromised === null) {
    await new Promise((r) => setTimeout(r, 200)); // yield: the heartbeat runs on the event loop
  }
  ok(managerLockCompromised !== null, "onCompromised fired after external removal");
  const child = localN8nProcess;
  const killDeadline = Date.now() + 8000;
  while (Date.now() < killDeadline && child.exitCode === null && pidAlive(child.pid)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  ok(child.exitCode !== null || !pidAlive(child.pid), "compromised -> our n8n child stopped (fail-closed)");
  try { child.kill("SIGKILL"); } catch {}
  localN8nProcess = null;
  const r2 = acquireN8nManagerLock();
  ok(r2.ok === false && /fail-closed/i.test((r2 as any).reason || ""), "post-compromise acquire refused fail-closed");
  await lastCompromisedStop; // let the async stop fully finish before the next test resets state
  fs.rmSync(d, { recursive: true, force: true });
}

// 13. compromised: a child ignoring SIGTERM is escalated to SIGKILL
{
  const d = freshDir();
  acquireN8nManagerLock();
  localN8nProcess = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"]);
  fs.rmdirSync(LOCKDIR());
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && managerLockCompromised === null) {
    await new Promise((r) => setTimeout(r, 200));
  }
  ok(managerLockCompromised !== null, "onCompromised fired (SIGTERM-ignoring child)");
  const child = localN8nProcess;
  const killDeadline = Date.now() + 12000;
  while (Date.now() < killDeadline && child.exitCode === null && pidAlive(child.pid)) {
    await new Promise((r) => setTimeout(r, 200));
  }
  ok(child.exitCode !== null || !pidAlive(child.pid), "compromised -> SIGTERM-ignoring child killed via SIGKILL");
  try { child.kill("SIGKILL"); } catch {}
  localN8nProcess = null;
  await lastCompromisedStop; // let the async stop fully finish before the next test resets state
  fs.rmSync(d, { recursive: true, force: true });
}

// 14. clean release must NOT trigger the compromise path: child untouched
{
  const d = freshDir();
  acquireN8nManagerLock();
  localN8nProcess = spawn("sleep", ["30"]);
  releaseN8nLock(process.pid); // clean release cancels the heartbeat
  await new Promise((r) => setTimeout(r, 2500)); // > 2 heartbeat intervals
  ok(managerLockCompromised === null, "clean release -> no onCompromised");
  const child = localN8nProcess;
  ok(child.exitCode === null && pidAlive(child.pid), "clean release -> our child NOT stopped");
  try { child.kill("SIGKILL"); } catch {}
  localN8nProcess = null;
  fs.rmSync(d, { recursive: true, force: true });
}

console.log(`UNIT RESULT: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
