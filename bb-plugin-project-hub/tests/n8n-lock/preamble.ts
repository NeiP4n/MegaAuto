import * as fs from "fs";
import * as path from "path";
import { spawn } from "node:child_process";
import { lockSync as lockfileLockSync } from "proper-lockfile";
// ---- harness stubs ----
function appendServerLog(_s: string) {}
let localN8nProcess: any = null; // real declaration: server.ts, before the lock section
function findPortPidTri(_p: number): { state: "free" } | { state: "occupied"; pid: number } | { state: "unknown" } {
  const s = process.env.TEST_PORT_STATE || "occupied";
  if (s === "free") return { state: "free" };
  if (s === "unknown") return { state: "unknown" };
  return { state: "occupied", pid: 1 };
}
function isLikelyN8nProcess(_pid: number): boolean { return true; }
