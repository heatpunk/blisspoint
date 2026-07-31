"use strict";
// Production server for StartOS: serves the built UI (dist/) and reverse-proxies
// /api/* to the local CGMiner proxy (server/proxy.cjs on 127.0.0.1:8081).
// Also handles /api/state for persisting application state to /data/state.json for StartOS backups.
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "80", 10);
const PROXY = process.env.PROXY_ORIGIN || "http://127.0.0.1:8081";
const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const DIST = path.join(__dirname, "..", "dist");
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json", ".png":"image/png", ".ico":"image/x-icon", ".woff2":"font/woff2" };

function handleState(req, res) {
  if (req.method === "GET") {
    fs.readFile(STATE_FILE, "utf8", (err, data) => {
      if (err) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({}));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
    });
  } else if (req.method === "POST" || req.method === "PUT") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        JSON.parse(body); // validate JSON
        fs.mkdir(DATA_DIR, { recursive: true }, (dirErr) => {
          if (dirErr) {
            res.writeHead(500, { "Content-Type": "application/json" });
            return res.end(JSON.stringify({ ok: false, error: dirErr.message }));
          }
          const tmp = STATE_FILE + ".tmp";
          fs.writeFile(tmp, body, "utf8", (wErr) => {
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
