/* ============================================================
   SMW POST MAKER — tiny local server.
   Serves the app + proxies music search/preview (CORS-free).
   Run:  node server.js   →  http://localhost:8787
   ============================================================ */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PORT = process.env.PORT || 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
};

/* hosts we're willing to proxy audio previews from */
const PREVIEW_HOSTS = /(\.mzstatic\.com|\.apple\.com|\.itunes\.apple\.com)$/;

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");

  /* ---- track search (iTunes Search API: no auth, 30s previews) ---- */
  if (u.pathname === "/api/music") {
    try {
      const q = u.searchParams.get("q") || "";
      const r = await fetch(
        "https://itunes.apple.com/search?media=music&limit=18&term=" + encodeURIComponent(q)
      );
      const j = await r.json();
      const out = (j.results || [])
        .filter((t) => t.previewUrl)
        .map((t) => ({
          title: t.trackName,
          artist: t.artistName,
          art: (t.artworkUrl100 || "").replace("100x100", "200x200"),
          preview: t.previewUrl,
        }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
    return;
  }

  /* ---- audio preview proxy (so the app can decode + mux it) ---- */
  if (u.pathname === "/api/preview") {
    try {
      const target = new URL(u.searchParams.get("url"));
      if (!PREVIEW_HOSTS.test(target.hostname)) {
        res.writeHead(403);
        return res.end("host not allowed");
      }
      const r = await fetch(target);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, {
        "Content-Type": r.headers.get("content-type") || "audio/mp4",
        "Content-Length": buf.length,
      });
      res.end(buf);
    } catch (e) {
      res.writeHead(502);
      res.end(String(e));
    }
    return;
  }

  /* ---- static files ---- */
  let p = decodeURIComponent(u.pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log("SMW Post Maker →  http://localhost:" + PORT);
});
