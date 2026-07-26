"use strict";
// Production server for StartOS: serves the built UI (dist/) and reverse-proxies
// /api/* to the local CGMiner proxy (server/proxy.cjs on 127.0.0.1:8081).
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "80", 10);
const PROXY = process.env.PROXY_ORIGIN || "http://127.0.0.1:8081";
const DIST = path.join(__dirname, "..", "dist");
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json", ".png":"image/png", ".ico":"image/x-icon", ".woff2":"font/woff2" };

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
