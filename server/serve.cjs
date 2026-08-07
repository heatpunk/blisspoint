"use strict";
// Production server for StartOS: serves the built UI (dist/) and reverse-proxies
// /api/* to the local CGMiner proxy (server/proxy.cjs on 127.0.0.1:8081).
// Also handles /api/state for persisting application state to /data/state.json for StartOS backups.
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
        if (parts.length === 4) {
          const first = parseInt(parts[0], 10);
          const second = parseInt(parts[1], 10);
          // Ignore loopback (127.x.x.x) and Docker internal bridge networks (172.16.0.0 - 172.31.255.255)
          if (first === 127) continue;
          if (first === 172 && second >= 16 && second <= 31) continue;
          return parts[0] + "." + parts[1] + "." + parts[2];
        }
      }
    }
  }
  return "192.168.1";
}

function handleState(req, res) {
  if (req.method === "GET") {
    fs.readFile(STATE_FILE, "utf8", (err, data) => {
      if (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({}));
      }
      try {
        const parsed = JSON.parse(data);
        const decrypted = processStateObject(parsed, decryptValue);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(decrypted));
      } catch (e) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      }
    });
  } else if (req.method === "POST" || req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body); // validate JSON
        const encrypted = processStateObject(parsed, encryptValue);
        const formatted = JSON.stringify(encrypted, null, 2);
        fs.mkdir(DATA_DIR, { recursive: true }, (dirErr) => {
          if (dirErr) {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: dirErr.message }));
          }
          const tmp = STATE_FILE + ".tmp";
          fs.writeFile(tmp, formatted, "utf8", (wErr) => {
            if (wErr) {
              res.writeHead(500, { "Content-Type": "application/json" });
              return res.end(JSON.stringify({ ok: false, error: wErr.message }));
            }
            fs.rename(tmp, STATE_FILE, (rErr) => {
              if (rErr) {
                res.writeHead(500, { "Content-Type": "application/json" });
                return res.end(JSON.stringify({ ok: false, error: rErr.message }));
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            });
          });
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
  if (uPath === "/api/state") {
    return handleState(req, res);
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
