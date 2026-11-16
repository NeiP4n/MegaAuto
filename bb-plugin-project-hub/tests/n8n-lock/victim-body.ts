// ---- victim body: acquire and hold until killed ----
const dir = process.argv[2];
const heldFile = process.argv[3];
n8nLockFile = dir + "/n8n.lock";
const r = acquireN8nManagerLock();
if (r.ok) {
  fs.writeFileSync(heldFile, String(process.pid));
  setInterval(() => {}, 1000); // keep the event loop alive: heartbeat runs
} else {
  fs.writeFileSync(heldFile, "FAILED:" + (r as any).reason);
  process.exit(1);
}
