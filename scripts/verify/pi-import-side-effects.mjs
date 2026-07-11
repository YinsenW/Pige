import childProcess from "node:child_process";
import dns from "node:dns";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { syncBuiltinESMExports } from "node:module";

const calls = [];
const restores = [];

patch(globalThis, "fetch", "fetch");
for (const [target, methods, prefix] of [
  [http, ["request", "get"], "http"],
  [https, ["request", "get"], "https"],
  [net, ["connect", "createConnection"], "net"],
  [tls, ["connect"], "tls"],
  [dns, ["lookup", "resolve", "resolve4", "resolve6"], "dns"],
  [childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"], "child_process"],
  [fs, ["writeFile", "writeFileSync", "appendFile", "appendFileSync", "rename", "renameSync"], "fs"]
]) {
  for (const method of methods) patch(target, method, `${prefix}.${method}`);
}
syncBuiltinESMExports();

try {
  await import("@earendil-works/pi-agent-core");
  await import("@earendil-works/pi-ai");
  await new Promise((resolve) => setImmediate(resolve));
  if (calls.length > 0) {
    throw new Error(`Pi import triggered side effects: ${calls.join(", ")}`);
  }
  console.log("Pi import side-effect snapshot OK: no fetch, socket, DNS, child-process, or filesystem mutation occurred.");
} finally {
  for (const restore of restores.reverse()) restore();
  syncBuiltinESMExports();
}

function patch(target, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || descriptor.writable !== true || typeof descriptor.value !== "function") return;
  const original = descriptor.value;
  Object.defineProperty(target, key, {
    ...descriptor,
    value: (..._args) => {
      calls.push(label);
      throw new Error(`Unexpected ${label} during Pi import.`);
    }
  });
  restores.push(() => Object.defineProperty(target, key, descriptor));
}
