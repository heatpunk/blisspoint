"use strict";
// Production server for StartOS: serves the built UI (dist/) and reverse-proxies
// /api/* to the local CGMiner proxy (server/proxy.cjs on 127.0.0.1:8081).
// Also handles /api/state and /api/subnet.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = parseInt(process.env.PORT || "80", 10);
const PROXY = process.env.PROXY_ORIGIN || "http://127.0.0.1:8081";
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const KEY_FILE = path.join(DATA_DIR, "secret.key");
const DIST = path.join(__dirname, "..", "dist");
// Sent to the browser in place of a stored miner password. The plaintext never
// leaves the server; control requests carrying this value get the real one
// injected server-side. See README "Credentials".
const MASKED = "__stored__";
const CONTROL_RE = /^\/api\/miners\/([^/]+)\/(power|pause|resume)$/;
const PASSWORD_RE = /^\/api\/miners\/([^/]+)\/password$/;
const MAX_BODY = 64 * 1024;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json", ".png":"image/png", ".ico":"image/x-icon", ".woff2":"font/woff2" };

function getOrCreateKey() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      return fs.readFileSync(KEY_FILE);
    }
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, key, { mode: 0o600 });
    return key;
  } catch (e) {
    return crypto.createHash("sha256").update("blisspoint-fallback-key").digest();
  }
}

function encryptValue(val) {
  if (typeof val !== "string" || !val || val.startsWith("enc:v1:")) return val;
  try {
    const key = getOrCreateKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    let encrypted = cipher.update(val, "utf8", "hex");
    encrypted += cipher.final("hex");
    const tag = cipher.getAuthTag().toString("hex");
    return "enc:v1:" + iv.toString("hex") + ":" + tag + ":" + encrypted;
  } catch (e) {
    return val;
  }
}

function decryptValue(val) {
  if (typeof val !== "string" || !val.startsWith("enc:v1:")) return val;
  try {
    const key = getOrCreateKey();
    const parts = val.slice(7).split(":");
    if (parts.length !== 3) return val;
    const iv = Buffer.from(parts[0], "hex");
    const tag = Buffer.from(parts[1], "hex");
    const encrypted = parts[2];
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (e) {
    return val;
  }
}

function processStateObject(obj, fn) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => processStateObject(item, fn));
  }
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "apiPassword" && typeof value === "string") {
      result[key] = fn(value);
    } else if (value && typeof value === "object") {
      result[key] = processStateObject(value, fn);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function getLocalSubnet() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal && iface.family === "IPv4") {
        const parts = iface.address.split(".");
        if (parts.length === 4 && parts[0] !== "127") {
          const first = parseInt(parts[0], 10);
          const second = parseInt(parts[1], 10);
          if (first === 172 && second >= 16 && second <= 31) {
            continue;
          }
          return parts[0] + "." + parts[1] + "." + parts[2];
        }
      }
    }
  }
  return "192.168.1";
}

function readStateFile() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (e) {
    return null;
  }
}

function writeStateFile(obj, cb) {
  const formatted = JSON.stringify(obj, null, 2);
  fs.mkdir(DATA_DIR, { recursive: true }, (dirErr) => {
    if (dirErr) return cb(dirErr);
    const tmp = STATE_FILE + ".tmp";
    fs.writeFile(tmp, formatted, "utf8", (wErr) => {
      if (wErr) return cb(wErr);
      fs.rename(tmp, STATE_FILE, cb);
    });
  });
}

/** Strip plaintext credentials: every stored apiPassword becomes MASKED. */
function maskState(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskState);
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "apiPassword" && typeof value === "string" && value) {
      out[key] = MASKED;
    } else if (value && typeof value === "object") {
      out[key] = maskState(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Put the stored ciphertext back wherever the client echoed MASKED. */
function restoreMasked(incoming, stored) {
  if (!incoming || !stored) return incoming;
  if (!Array.isArray(incoming.miners) || !Array.isArray(stored.miners)) return incoming;
  const byId = new Map(stored.miners.filter(Boolean).map((m) => [m.id, m]));
  const byIp = new Map(stored.miners.filter(Boolean).map((m) => [m.ip, m]));
  for (const miner of incoming.miners) {
    if (!miner || typeof miner !== "object" || !miner.config) continue;
    const prev = byId.get(miner.id) || byIp.get(miner.ip);
    const saved = prev && prev.config ? prev.config.apiPassword : undefined;
    const sent = miner.config.apiPassword;
    if (sent === MASKED || sent === undefined || sent === null) {
      if (typeof saved === "string" && saved) miner.config.apiPassword = saved;
      else delete miner.config.apiPassword;
    }
  }
  return incoming;
}

/** Decrypted control password for a miner IP, or null when none is stored. */
function storedPasswordForIp(ip) {
  const state = readStateFile();
  if (!state || !Array.isArray(state.miners)) return null;
  const miner = state.miners.find((m) => m && m.ip === ip);
  const value = miner && miner.config ? miner.config.apiPassword : null;
  if (typeof value !== "string" || !value) return null;
  return decryptValue(value);
}

function readBody(req, limit, cb) {
  let body = "";
  let tooBig = false;
  req.on("data", (chunk) => {
    if (tooBig) return;
    body += chunk;
    if (body.length > limit) {
      tooBig = true;
      cb(new Error("body too large"));
      req.destroy();
    }
  });
  req.on("end", () => {
    if (!tooBig) cb(null, body);
  });
}

/** Cross-origin guard for state-changing requests (CSRF / DNS rebinding). */
function crossOrigin(req) {
  const site = req.headers["sec-fetch-site"];
  if (site === "cross-site") return true;
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host !== (req.headers.host || "");
  } catch (e) {
    return true;
  }
}

function handleState(req, res) {
  if (req.method === "GET") {
    fs.readFile(STATE_FILE, "utf8", (err, data) => {
      res.setHeader("Cache-Control", "no-store");
      if (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({}));
      }
      try {
        const parsed = JSON.parse(data);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(maskState(parsed)));
      } catch (e) {
        // Unreadable state must not leak raw bytes that may hold credentials.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({}));
      }
    });
  } else if (req.method === "POST" || req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body); // validate JSON
        const merged = restoreMasked(parsed, readStateFile());
        const encrypted = processStateObject(merged, encryptValue);
        writeStateFile(encrypted, (err) => {
          if (err) {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: err.message }));
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
      }
    });
  } else if (req.method === "DELETE") {
    fs.unlink(STATE_FILE, () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  } else {
    res.writeHead(405);
    res.end();
  }
}

/** Persist a miner control password without ever returning it to the client. */
function handleSetPassword(req, res, ip) {
  readBody(req, MAX_BODY, (err, body) => {
    if (err) {
      res.writeHead(413, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "body too large" }));
    }
    let password;
    try {
      password = JSON.parse(body || "{}").password;
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
    }
    if (typeof password !== "string" || password === "") {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "password required" }));
    }
    const state = readStateFile();
    if (!state || !Array.isArray(state.miners)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "miner not saved yet" }));
    }
    const miner = state.miners.find((m) => m && m.ip === ip);
    if (!miner) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "miner not saved yet" }));
    }
    miner.config = miner.config || {};
    miner.config.apiPassword = password;
    writeStateFile(processStateObject(state, encryptValue), (wErr) => {
      if (wErr) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ok: false, error: wErr.message }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
  });
}

/** Forward a control request to the proxy with the stored password injected. */
function proxyControl(req, res, ip) {
  readBody(req, MAX_BODY, (err, body) => {
    if (err) {
      res.writeHead(413, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "body too large" }));
    }
    let payload;
    try {
      payload = JSON.parse(body || "{}");
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
    }
    if (typeof payload.password !== "string" || !payload.password || payload.password === MASKED) {
      const stored = storedPasswordForIp(ip);
      if (stored) payload.password = stored;
      else delete payload.password;
    }
    const out = JSON.stringify(payload);
    const preq = http.request(new URL(req.url, PROXY), {
      method: req.method,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(out),
      },
    }, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    preq.on("error", () => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "proxy down" }));
    });
    preq.end(out);
  });
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      fs.readFile(path.join(DIST, "index.html"), (e2, html) => {
        if (e2) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(html);
      });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

http.createServer((req, res) => {
  const uPath = new URL(req.url, "http://x").pathname;
  const mutating = req.method === "POST" || req.method === "PUT" || req.method === "DELETE";
  if (uPath === "/api/state") {
    if (mutating && crossOrigin(req)) { res.writeHead(403); return res.end(); }
    return handleState(req, res);
  }
  const pw = uPath.match(PASSWORD_RE);
  if (pw) {
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    if (crossOrigin(req)) { res.writeHead(403); return res.end(); }
    return handleSetPassword(req, res, decodeURIComponent(pw[1]));
  }
  const control = uPath.match(CONTROL_RE);
  if (control) {
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    if (crossOrigin(req)) { res.writeHead(403); return res.end(); }
    return proxyControl(req, res, decodeURIComponent(control[1]));
  }
  if (uPath === "/api/subnet") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ subnet: getLocalSubnet() }));
  }
  if (req.url.startsWith("/api/")) {
    const preq = http.request(new URL(req.url, PROXY), { method: req.method, headers: req.headers }, (pres) => {
      res.writeHead(pres.statusCode || 502, pres.headers);
      pres.pipe(res);
    });
    preq.on("error", () => { res.writeHead(502); res.end(JSON.stringify({ ok:false, error:"proxy down" })); });
    req.pipe(preq);
    return;
  }
  serveStatic(req, res);
}).listen(PORT, "0.0.0.0", () => console.log("Blisspoint serving on :" + PORT + " (UI + /api -> " + PROXY + ")"));
