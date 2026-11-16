// ---- worker body ----
const dir = process.argv[2];
const logFile = process.argv[3];
n8nLockFile = dir + "/n8n.lock";
function busy(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(1, Math.floor(ms)));
}
for (let i = 0; i < 80; i++) {
  const r = acquireN8nManagerLock();
  if (r.ok) {
    fs.appendFileSync(logFile, `BEGIN ${process.pid}\n`);
    busy(5 + Math.random() * 15);
    fs.appendFileSync(logFile, `END ${process.pid}\n`);
    releaseN8nLock(process.pid);
  }
  busy(100 + Math.random() * 200);
}
