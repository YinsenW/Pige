import assert from "node:assert/strict";
import { verifyWorkspaceLockUsage } from "./dependency-workspace-lock.mjs";

const usage = {
  file: "apps/desktop/package.json",
  section: "dependencies",
  name: "undici",
  version: "8.7.0",
  manifestVersion: "8.7.0"
};

function fixture() {
  return {
    packages: {
      "": {},
      "apps/desktop": { dependencies: { undici: "8.7.0" } },
      "node_modules/undici": { version: "7.28.0" },
      "apps/desktop/node_modules/undici": { version: "8.7.0" }
    }
  };
}

assert.equal(
  verifyWorkspaceLockUsage({ lockfile: fixture(), ...usage }),
  "apps/desktop/node_modules/undici",
  "A nested direct runtime dependency must win over an unrelated root transitive version."
);

const wrongEdge = fixture();
wrongEdge.packages["apps/desktop"].dependencies.undici = "8.6.0";
assert.throws(
  () => verifyWorkspaceLockUsage({ lockfile: wrongEdge, ...usage }),
  /workspace edge apps\/desktop dependencies\.undici is 8\.6\.0, expected 8\.7\.0/u
);

const wrongNestedVersion = fixture();
wrongNestedVersion.packages["apps/desktop/node_modules/undici"].version = "8.6.0";
assert.throws(
  () => verifyWorkspaceLockUsage({ lockfile: wrongNestedVersion, ...usage }),
  /installed entry apps\/desktop\/node_modules\/undici has undici@8\.6\.0, manifest expects 8\.7\.0/u
);

const hoisted = fixture();
delete hoisted.packages["apps/desktop/node_modules/undici"];
hoisted.packages["node_modules/undici"].version = "8.7.0";
assert.equal(
  verifyWorkspaceLockUsage({ lockfile: hoisted, ...usage }),
  "node_modules/undici",
  "A matching root-hoisted direct dependency must remain valid."
);

console.log("Dependency workspace lock cases OK: nested direct, root transitive, edge/version mutations, and hoist fallback verified.");
