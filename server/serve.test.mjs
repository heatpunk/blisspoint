// Server-side credential handling tests. Run with: node --test server/
// Covers: state masking, ciphertext preservation, password injection into the
// proxy, the explicit password endpoint, and the cross-origin guard.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "serve.cjs");

async function startFakeProxy() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      seen.push({ url: req.url, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, needPassword: false }));
    });
  });
  await new Promise((resolve) => srv.listen(0, "127.0.0.1", resolve));
  return { srv, port: srv.address().port, seen };
}

async function startServer(dataDir, proxyPort) {
  const port = 39000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, [script], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      PROXY_ORIGIN: `http://127.0.0.1:${proxyPort}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 8000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("serving on")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
  return { port, child };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blisspoint-serve-"));
}

const state = {
  miners: [
    {
      id: "m1",
      ip: "192.168.1.50",
      model: "S19",
      config: { name: "Soffan", powerMin: 0, powerMax: 0, powerTarget: 0 },
    },
  ],
  selectedId: "m1",
  theme: "dark",
};

async function withServer(fn) {
  const proxy = await startFakeProxy();
  const dataDir = tmpDir();
  const server = await startServer(dataDir, proxy.port);
  try {
    await fn({ base: `http://127.0.0.1:${server.port}`, dataDir, proxy });
  } finally {
    server.child.kill();
    proxy.srv.close();
  }
}

test("stored password never leaves the server over GET /api/state", async () => {
  await withServer(async ({ base, dataDir }) => {
    const post = await fetch(`${base}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...state,
        miners: [{ ...state.miners[0], config: { ...state.miners[0].config, apiPassword: "hunter2" } }],
      }),
    });
    assert.equal(post.status, 200);

    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
    assert.match(onDisk.miners[0].config.apiPassword, /^enc:v1:/, "password must be encrypted at rest");

    const get = await fetch(`${base}/api/state`);
    const body = await get.json();
    assert.equal(body.miners[0].config.apiPassword, "__stored__");
    assert.ok(!JSON.stringify(body).includes("hunter2"), "plaintext must not appear in the response");
  });
});

test("echoing the placeholder keeps the stored ciphertext", async () => {
  await withServer(async ({ base, dataDir }) => {
    await fetch(`${base}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...state,
        miners: [{ ...state.miners[0], config: { ...state.miners[0].config, apiPassword: "hunter2" } }],
      }),
    });
    const before = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));

    const echoed = await (await fetch(`${base}/api/state`)).json();
    const res = await fetch(`${base}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(echoed),
    });
    assert.equal(res.status, 200);

    const after = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
    assert.equal(after.miners[0].config.apiPassword, before.miners[0].config.apiPassword);
  });
});

test("control requests get the stored password injected before the proxy sees them", async () => {
  await withServer(async ({ base, proxy }) => {
    await fetch(`${base}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...state,
        miners: [{ ...state.miners[0], config: { ...state.miners[0].config, apiPassword: "hunter2" } }],
      }),
    });

    const res = await fetch(`${base}/api/miners/192.168.1.50/power`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ watts: 900 }),
    });
    assert.equal(res.status, 200);
    assert.equal(proxy.seen.length, 1);
    const forwarded = JSON.parse(proxy.seen[0].body);
    assert.equal(forwarded.watts, 900);
    assert.equal(forwarded.password, "hunter2");
  });
});

test("POST /api/miners/:ip/password stores the credential encrypted", async () => {
  await withServer(async ({ base, dataDir }) => {
    await fetch(`${base}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });

    const res = await fetch(`${base}/api/miners/192.168.1.50/password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "hunter2" }),
    });
    assert.equal(res.status, 200);

    const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "state.json"), "utf8"));
    assert.match(onDisk.miners[0].config.apiPassword, /^enc:v1:/);
    const get = await (await fetch(`${base}/api/state`)).json();
    assert.equal(get.miners[0].config.apiPassword, "__stored__");
  });
});

test("cross-origin writes are rejected", async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(`${base}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify(state),
    });
    assert.equal(res.status, 403);

    const del = await fetch(`${base}/api/state`, {
      method: "DELETE",
      headers: { origin: "http://evil.example" },
    });
    assert.equal(del.status, 403);
  });
});

test("same-origin DELETE still resets the state", async () => {
  await withServer(async ({ base, dataDir }) => {
    await fetch(`${base}/api/state`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(state),
    });
    assert.ok(fs.existsSync(path.join(dataDir, "state.json")));
    const res = await fetch(`${base}/api/state`, { method: "DELETE" });
    assert.equal(res.status, 200);
    assert.ok(!fs.existsSync(path.join(dataDir, "state.json")));
  });
});
