import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import { createSecureServer } from "node:http2";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app } from "electron";

const ELECTRON_VERSION = "43.1.0";
const NODE_VERSION = "24.18.0";
const UNDICI_VERSION = "8.7.0";
const SMOKE_TIMEOUT_MS = 15_000;
const LOOPBACK_ADDRESS = "127.0.0.1";
const ORIGIN_HOSTNAME = "origin.pige.test";
const REDIRECT_HOSTNAME = "redirect.pige.test";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const builtMainPath = path.join(root, "apps/desktop/out/main/index.js");

let smokeStage = "Electron app readiness";
let finished = false;
const finish = (exitCode, caught) => {
  if (finished) return;
  finished = true;
  clearTimeout(smokeTimeout);
  if (caught !== undefined) console.error(caught instanceof Error ? caught.stack : caught);
  app.exit(exitCode);
};
const smokeTimeout = setTimeout(() => {
  finish(1, new Error(`Electron Undici transport smoke timed out during: ${smokeStage}`));
}, SMOKE_TIMEOUT_MS);

void app.whenReady().then(async () => {
  smokeStage = "assembled runtime inspection";
  await runSmoke();
  finish(0);
}).catch((caught) => finish(1, caught));

async function runSmoke() {
  assert.equal(process.type, "browser", "Smoke must run in the Electron main process.");
  assert.equal(process.versions.electron, ELECTRON_VERSION, "Unexpected Electron runtime version.");
  assert.equal(process.versions.node, NODE_VERSION, "Unexpected Electron embedded Node version.");
  assert.ok(fs.existsSync(builtMainPath), "Missing assembled main runtime. Run npm run build first.");
  assertBuiltTransportPolicy(fs.readFileSync(builtMainPath, "utf8"));

  const requireFromBuiltMain = createRequire(pathToFileURL(builtMainPath));
  const undiciEntryPath = requireFromBuiltMain.resolve("undici");
  const undiciPackagePath = requireFromBuiltMain.resolve("undici/package.json");
  const undiciPackage = requireFromBuiltMain(undiciPackagePath);
  const { Agent, fetch } = requireFromBuiltMain("undici");
  const expectedUndiciRoot = fs.realpathSync(path.join(root, "apps/desktop/node_modules/undici"));

  assert.equal(undiciPackage.version, UNDICI_VERSION, "Assembled main runtime resolved the wrong Undici version.");
  assert.ok(
    fs.realpathSync(undiciEntryPath).startsWith(`${expectedUndiciRoot}${path.sep}`),
    "Assembled main runtime did not resolve its production Undici dependency."
  );

  const observations = {
    alpnProtocols: [],
    finalRequests: 0,
    httpVersions: [],
    remoteAddresses: [],
    startRequests: 0
  };
  const tlsFixture = createTlsFixture();
  const server = createSmokeServer(observations, tlsFixture);
  const priorProxyEnvironment = installFailingProxyEnvironment();
  try {
    smokeStage = "synthetic HTTPS server startup";
    const port = await listen(server);
    const validationEvents = [];
    const transportEvents = [];
    const dispatchers = [];
    const resolutions = new Map([
      [ORIGIN_HOSTNAME, [LOOPBACK_ADDRESS]],
      [REDIRECT_HOSTNAME, [LOOPBACK_ADDRESS]]
    ]);

    const originalTarget = validateSyntheticTarget(
      `https://${ORIGIN_HOSTNAME}:${port}/start`,
      resolutions,
      validationEvents,
      transportEvents
    );
    smokeStage = "first pinned manual fetch hop";
    const originalHop = await fetchHop(
      originalTarget,
      Agent,
      fetch,
      dispatchers,
      transportEvents,
      tlsFixture.certificate
    );
    assert.equal(originalHop.response.status, 302, "The first hop did not expose its redirect for manual handling.");
    assert.equal(observations.finalRequests, 0, "Undici followed the redirect before Pige revalidated it.");
    const location = originalHop.response.headers.get("location");
    assert.ok(location, "Synthetic redirect omitted its Location header.");
    const redirectedTarget = validateSyntheticTarget(
      new URL(location, originalTarget.url).toString(),
      resolutions,
      validationEvents,
      transportEvents
    );
    smokeStage = "first dispatcher close";
    await disposeHop(originalHop);

    smokeStage = "redirected pinned manual fetch hop";
    const redirectedHop = await fetchHop(
      redirectedTarget,
      Agent,
      fetch,
      dispatchers,
      transportEvents,
      tlsFixture.certificate
    );
    assert.equal(await redirectedHop.response.text(), "undici-electron-transport-ok");
    smokeStage = "redirected dispatcher close";
    await disposeHop(redirectedHop);

    assert.deepEqual(validationEvents, [
      { hostname: ORIGIN_HOSTNAME, addresses: [LOOPBACK_ADDRESS] },
      { hostname: REDIRECT_HOSTNAME, addresses: [LOOPBACK_ADDRESS] }
    ]);
    assert.equal(dispatchers.length, 2, "Each redirect hop must receive a fresh Agent.");
    assert.notEqual(dispatchers[0].dispatcher, dispatchers[1].dispatcher, "Redirect hops reused an Agent.");
    assert.ok(dispatchers.every((record) => record.disposal === "close"));
    assert.ok(dispatchers.every((record) => record.dispatcher.closed && record.dispatcher.destroyed));
    assert.deepEqual(observations.httpVersions, ["1.1", "1.1"]);
    assert.deepEqual(observations.alpnProtocols, ["http/1.1", "http/1.1"]);
    assert.deepEqual(observations.remoteAddresses, [LOOPBACK_ADDRESS, LOOPBACK_ADDRESS]);
    assert.equal(observations.startRequests, 1);
    assert.equal(observations.finalRequests, 1);
    assertValidationPrecedesConnect(transportEvents, ORIGIN_HOSTNAME);
    assertValidationPrecedesConnect(transportEvents, REDIRECT_HOSTNAME);

    const destroyedDispatcher = new Agent({
      allowH2: false,
      connections: 1,
      connect: {
        ca: tlsFixture.certificate,
        lookup: createPinnedLookup(ORIGIN_HOSTNAME, [LOOPBACK_ADDRESS], transportEvents)
      }
    });
    smokeStage = "pinned lookup rejection and dispatcher destroy";
    await assert.rejects(fetch(`https://unvalidated.pige.test:${port}/blocked`, {
      dispatcher: destroyedDispatcher,
      redirect: "manual"
    }));
    await destroyedDispatcher.destroy();
    assert.equal(destroyedDispatcher.destroyed, true, "Failed dispatcher did not support deterministic destroy.");

    console.log(
      `Electron Undici transport smoke OK: Electron ${process.versions.electron}, Node ${process.versions.node}, ` +
      `Undici ${undiciPackage.version}; pinned manual redirect hops used HTTP/1.1 and closed, failure Agent destroyed.`
    );
  } finally {
    smokeStage = "synthetic HTTPS server teardown";
    restoreProxyEnvironment(priorProxyEnvironment);
    await closeServer(server);
  }
}

function assertBuiltTransportPolicy(builtMain) {
  const requiredMarkers = [
    ["explicit HTTP/2 disable", /allowH2:\s*false/u],
    ["manual redirect handling", /redirect:\s*"manual"/u],
    ["validated-address lookup pin", /connect:\s*\{\s*lookup:\s*createPinnedLookup/u],
    ["graceful dispatcher close", /await dispatcher\.close\(\)/u],
    ["failed dispatcher destroy", /await dispatcher\.destroy\(\)\.catch/u]
  ];
  for (const [label, pattern] of requiredMarkers) {
    assert.match(builtMain, pattern, `Assembled main runtime omitted ${label}.`);
  }
  assert.doesNotMatch(builtMain, /setGlobalDispatcher|EnvHttpProxyAgent/u, "SourceFetch must not install a global or ambient proxy dispatcher.");
}

function createSmokeServer(observations, tlsFixture) {
  const server = createSecureServer({
    allowHTTP1: true,
    cert: tlsFixture.certificate,
    key: tlsFixture.privateKey
  });
  server.on("secureConnection", (socket) => {
    observations.alpnProtocols.push(socket.alpnProtocol);
    observations.remoteAddresses.push(socket.remoteAddress);
  });
  server.on("request", (request, response) => {
    observations.httpVersions.push(request.httpVersion);
    const requestUrl = new URL(request.url ?? "/", `https://${request.headers.host ?? ORIGIN_HOSTNAME}`);
    if (requestUrl.pathname === "/start") {
      observations.startRequests += 1;
      const port = server.address().port;
      response.writeHead(302, { location: `https://${REDIRECT_HOSTNAME}:${port}/final` });
      response.end();
      return;
    }
    if (requestUrl.pathname === "/final") {
      observations.finalRequests += 1;
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("undici-electron-transport-ok");
      return;
    }
    response.writeHead(404);
    response.end();
  });
  return server;
}

function validateSyntheticTarget(value, resolutions, validationEvents, transportEvents) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.username, "");
  assert.equal(parsed.password, "");
  const addresses = resolutions.get(parsed.hostname);
  assert.ok(addresses && addresses.length > 0, `Synthetic hostname was not resolved and approved: ${parsed.hostname}`);
  assert.ok(addresses.every((address) => net.isIP(address) > 0), "Synthetic resolution returned a non-IP address.");
  validationEvents.push({ hostname: parsed.hostname, addresses: [...addresses] });
  transportEvents.push({ kind: "validated", hostname: parsed.hostname });
  return { url: parsed.toString(), hostname: parsed.hostname, addresses };
}

async function fetchHop(target, Agent, fetch, dispatchers, transportEvents, certificate) {
  const record = {
    dispatcher: new Agent({
      allowH2: false,
      connections: 1,
      pipelining: 1,
      connect: {
        ca: certificate,
        lookup: createPinnedLookup(target.hostname, target.addresses, transportEvents)
      }
    }),
    disposal: undefined,
    hostname: target.hostname
  };
  dispatchers.push(record);
  transportEvents.push({ kind: "agent-created", hostname: target.hostname });
  try {
    const response = await fetch(target.url, {
      dispatcher: record.dispatcher,
      redirect: "manual"
    });
    return { record, response };
  } catch (caught) {
    record.disposal = "destroy";
    await record.dispatcher.destroy().catch(() => undefined);
    throw caught;
  }
}

function createTlsFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const signatureAlgorithm = derSequence(derOid("1.2.840.10045.4.3.2"));
  const commonName = derSequence(
    derSet(derSequence(derOid("2.5.4.3"), derValue(0x0c, Buffer.from(ORIGIN_HOSTNAME))))
  );
  const now = Date.now();
  const validity = derSequence(derUtcTime(new Date(now - 60_000)), derUtcTime(new Date(now + 86_400_000)));
  const subjectAltName = derSequence(
    derOid("2.5.29.17"),
    derValue(0x04, derSequence(
      derValue(0x82, Buffer.from(ORIGIN_HOSTNAME, "ascii")),
      derValue(0x82, Buffer.from(REDIRECT_HOSTNAME, "ascii"))
    ))
  );
  const basicConstraints = derSequence(
    derOid("2.5.29.19"),
    derValue(0x01, Buffer.from([0xff])),
    derValue(0x04, derSequence(derValue(0x01, Buffer.from([0xff]))))
  );
  const serial = randomBytes(16);
  const tbsCertificate = derSequence(
    derValue(0xa0, derInteger(Buffer.from([2]))),
    derInteger(serial),
    signatureAlgorithm,
    commonName,
    validity,
    commonName,
    publicKey.export({ format: "der", type: "spki" }),
    derValue(0xa3, derSequence(basicConstraints, subjectAltName))
  );
  const certificate = derSequence(
    tbsCertificate,
    signatureAlgorithm,
    derValue(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbsCertificate, privateKey)]))
  );
  return {
    certificate: toPem("CERTIFICATE", certificate),
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" })
  };
}

function derSequence(...parts) {
  return derValue(0x30, Buffer.concat(parts));
}

function derSet(...parts) {
  return derValue(0x31, Buffer.concat(parts));
}

function derInteger(bytes) {
  const positive = bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
  return derValue(0x02, positive);
}

function derOid(value) {
  const parts = value.split(".").map(Number);
  assert.ok(parts.length >= 2 && parts.every(Number.isSafeInteger), `Invalid OID: ${value}`);
  const encoded = [encodeBase128(parts[0] * 40 + parts[1]), ...parts.slice(2).map(encodeBase128)];
  return derValue(0x06, Buffer.concat(encoded));
}

function encodeBase128(value) {
  const bytes = [value & 0x7f];
  for (let remaining = Math.floor(value / 128); remaining > 0; remaining = Math.floor(remaining / 128)) {
    bytes.unshift((remaining & 0x7f) | 0x80);
  }
  return Buffer.from(bytes);
}

function derUtcTime(value) {
  const two = (part) => String(part).padStart(2, "0");
  const encoded = `${two(value.getUTCFullYear() % 100)}${two(value.getUTCMonth() + 1)}` +
    `${two(value.getUTCDate())}${two(value.getUTCHours())}${two(value.getUTCMinutes())}` +
    `${two(value.getUTCSeconds())}Z`;
  return derValue(0x17, Buffer.from(encoded, "ascii"));
}

function derValue(tag, content) {
  return Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
}

function derLength(length) {
  if (length < 0x80) return Buffer.from([length]);
  const bytes = [];
  for (let remaining = length; remaining > 0; remaining = Math.floor(remaining / 256)) {
    bytes.unshift(remaining & 0xff);
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function toPem(label, der) {
  const body = der.toString("base64").match(/.{1,64}/gu)?.join("\n") ?? "";
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

async function disposeHop(hop) {
  if (hop.response.body && !hop.response.bodyUsed) await hop.response.body.cancel();
  try {
    await hop.record.dispatcher.close();
    hop.record.disposal = "close";
  } catch {
    await hop.record.dispatcher.destroy().catch(() => undefined);
    hop.record.disposal = "destroy";
  }
}

function createPinnedLookup(expectedHostname, addresses, transportEvents) {
  const records = addresses.map((address) => ({ address, family: net.isIP(address) }));
  return (requestedHostname, options, callback) => {
    transportEvents.push({ kind: "lookup", hostname: requestedHostname });
    if (requestedHostname.toLocaleLowerCase() !== expectedHostname.toLocaleLowerCase()) {
      callback(Object.assign(new Error("Pinned DNS lookup hostname mismatch."), { code: "EACCES" }), "", 0);
      return;
    }
    const requestedFamily = typeof options === "number" ? options : options.family;
    const eligible = requestedFamily === 4 || requestedFamily === 6
      ? records.filter((record) => record.family === requestedFamily)
      : records;
    if (typeof options === "object" && options.all) {
      callback(null, eligible);
      return;
    }
    const selected = eligible[0];
    if (!selected) {
      callback(Object.assign(new Error("No validated address matches the requested family."), { code: "ENOTFOUND" }), "", 0);
      return;
    }
    callback(null, selected.address, selected.family);
  };
}

function assertValidationPrecedesConnect(events, hostname) {
  const validationIndex = events.findIndex((event) => event.kind === "validated" && event.hostname === hostname);
  const agentIndex = events.findIndex((event) => event.kind === "agent-created" && event.hostname === hostname);
  const lookupIndex = events.findIndex((event) => event.kind === "lookup" && event.hostname === hostname);
  assert.ok(validationIndex >= 0 && validationIndex < agentIndex && agentIndex < lookupIndex, `Validation did not precede connect for ${hostname}.`);
}

function installFailingProxyEnvironment() {
  const names = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"];
  const prior = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) process.env[name] = "http://127.0.0.1:1";
  return prior;
}

function restoreProxyEnvironment(prior) {
  for (const [name, value] of prior) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_ADDRESS, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Synthetic server did not bind a TCP port."));
        return;
      }
      resolve(address.port);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => error ? reject(error) : resolve());
  });
}
