"use strict";

const express = require("express");
const Parser = require("rss-parser");
const iconv = require("iconv-lite");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";
const MAX_VISITS = 800;
const NEWS_TTL_MS = 5 * 60 * 1000;
const VISIT_COOLDOWN_MS = 20 * 1000;
const DATA_DIR = path.join(__dirname, "data");
const VISITS_FILE = path.join(DATA_DIR, "visits.json");

const FEEDS = [
  { id: "tass", name: "TASS", url: "https://tass.ru/rss/v2.xml", color: "#c8102e" },
  { id: "ria", name: "RIA Novosti", url: "https://ria.ru/export/rss2/index.xml", color: "#e30613" },
  { id: "lenta", name: "Lenta.ru", url: "https://lenta.ru/rss", color: "#ee1c25" },
  { id: "kommersant", name: "Коммерсантъ", url: "https://www.kommersant.ru/RSS/main.xml", color: "#111111" },
  { id: "izvestia", name: "Известия", url: "https://iz.ru/xml/rss/all.xml", color: "#1a3c6e" },
  { id: "mk", name: "МК", url: "https://www.mk.ru/rss/index.xml", color: "#b71c1c" },
  { id: "gazeta", name: "Газета.Ru", url: "https://www.gazeta.ru/export/rss/first.xml", color: "#2c3e50" },
];

const parser = new Parser({
  timeout: 12000,
  headers: {
    "User-Agent": "EmpreintePedagogique/1.0 (educational news reader; +https://example.invalid)",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumb"],
    ],
  },
});

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

app.use(express.json({ limit: "32kb" }));
app.use((req, res, next) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  res.charset = "utf-8";
  next();
});

app.use((req, res, next) => {
  if (req.method === "GET" && (req.path === "/" || req.path === "/index.html")) {
    recordHit(req, null).catch((err) => console.error("recordHit", err.message || err));
  }
  next();
});

app.use(
  express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  })
);

let newsCache = { at: 0, items: [], errors: [] };
const lastVisitByIp = new Map();

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(VISITS_FILE)) fs.writeFileSync(VISITS_FILE, "[]\n", "utf8");
}

function readVisits() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(VISITS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeVisits(visits) {
  ensureDataFile();
  const tmp = VISITS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(visits, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, VISITS_FILE);
}

function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  const real = req.headers["x-real-ip"];
  if (typeof real === "string" && real.trim()) return real.trim();
  let ip = req.socket.remoteAddress || "";
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip === "::1") ip = "127.0.0.1";
  return ip;
}

function isPrivateIp(ip) {
  return (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

async function geoFromIp(ip) {
  if (isPrivateIp(ip)) {
    return {
      source: "local",
      city: "réseau local",
      region: null,
      country: "Local",
      countryCode: null,
      lat: null,
      lon: null,
      isp: "loopback / LAN",
      timezone: null,
    };
  }
  try {
    const url = `https://ipwho.is/${encodeURIComponent(ip)}?fields=success,message,city,region,country,country_code,latitude,longitude,connection,timezone`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error("geo http " + res.status);
    const j = await res.json();
    if (!j.success) throw new Error(j.message || "geo fail");
    return {
      source: "ipwho.is",
      city: j.city || null,
      region: j.region || null,
      country: j.country || null,
      countryCode: j.country_code || null,
      lat: typeof j.latitude === "number" ? j.latitude : null,
      lon: typeof j.longitude === "number" ? j.longitude : null,
      isp: (j.connection && (j.connection.isp || j.connection.org)) || null,
      timezone: (j.timezone && (j.timezone.id || j.timezone)) || null,
    };
  } catch (err) {
    return {
      source: "unavailable",
      city: null,
      region: null,
      country: null,
      countryCode: null,
      lat: null,
      lon: null,
      isp: null,
      timezone: null,
      error: String(err.message || err),
    };
  }
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const n = parseInt(h, 16);
      return n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&#(\d+);/g, (_, d) => {
      const n = Number(d);
      return n < 0x110000 ? String.fromCodePoint(n) : "";
    })
    .replace(/&amp;/gi, "&");
}

function stripHtml(s) {
  return decodeEntities(
    String(s || "")
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  )
    .replace(/\s*\/\/\s*/g, " — ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickImage(item) {
  if (item.enclosure && item.enclosure.url && /image|jpg|jpeg|png|webp|gif/i.test(item.enclosure.type || item.enclosure.url)) {
    return item.enclosure.url;
  }
  const media = item.mediaContent;
  if (media) {
    if (typeof media === "string" && /^https?:/.test(media)) return media;
    if (media.$ && media.$.url) return media.$.url;
    if (Array.isArray(media) && media[0] && media[0].$ && media[0].$.url) return media[0].$.url;
  }
  const thumb = item.mediaThumb;
  if (thumb && thumb.$ && thumb.$.url) return thumb.$.url;
  const html = String(item.content || item["content:encoded"] || item.description || "");
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function guessImage(item, feedId, picked) {
  if (picked) return picked;
  const link = item.link || "";
  if (feedId === "ria") {
    const m = link.match(/(\d{7,})\.html/);
    if (m) return `https://cdnn21.img.ria.ru/images/sharing/article/${m[1]}.jpg`;
  }
  if (feedId === "kommersant") {
    const m = link.match(/\/doc\/(\d+)/);
    if (m) return `https://iv.kommersant.ru/SocialPics/${m[1]}`;
  }
  return null;
}

function charsetOf(contentType, xmlHead) {
  const fromHeader = String(contentType || "").match(/charset=([^\s;]+)/i);
  const fromXml = String(xmlHead || "").match(/encoding=["']([^"']+)["']/i);
  let cs = ((fromHeader && fromHeader[1]) || (fromXml && fromXml[1]) || "utf-8")
    .trim()
    .replace(/["']/g, "")
    .toLowerCase();
  if (cs === "cp1251" || cs === "windows-1251" || cs === "win-1251") return "win1251";
  if (cs === "utf8") return "utf-8";
  return cs;
}

function looksBrokenCyrillic(s) {
  const sample = String(s || "").slice(0, 3000);
  const cyr = (sample.match(/[А-Яа-яЁё]/g) || []).length;
  const repl = (sample.match(/�/g) || []).length;
  return cyr < 10 || repl > 4;
}

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  const res = await fetch(feed.url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "EmpreintePedagogique/1.0 (educational news reader)",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error("http " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const headAscii = buf.subarray(0, 220).toString("latin1");
  let xml = iconv.decode(buf, charsetOf(res.headers.get("content-type"), headAscii));
  if (looksBrokenCyrillic(xml)) xml = iconv.decode(buf, "win1251");
  xml = xml.replace(/^\uFEFF/, "");
  const parsed = await parser.parseString(xml);
  return (parsed.items || []).slice(0, 24).map((item) => ({
    id: item.guid || item.link || `${feed.id}-${item.title}`,
    title: stripHtml(item.title) || "(sans titre)",
    link: item.link || parsed.link || "#",
    source: feed.name,
    sourceId: feed.id,
    color: feed.color,
    category: stripHtml(item.categories && item.categories[0]) || stripHtml(item.category) || null,
    publishedAt: item.isoDate || item.pubDate || null,
    summary: stripHtml(item.contentSnippet || item.summary || item.description).slice(0, 280),
    image: guessImage(item, feed.id, pickImage(item)),
  }));
}

async function loadNews(force) {
  const now = Date.now();
  if (!force && newsCache.items.length && now - newsCache.at < NEWS_TTL_MS) {
    return newsCache;
  }
  const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
  const items = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") items.push(...r.value);
    else errors.push({ source: FEEDS[i].name, error: String(r.reason && r.reason.message ? r.reason.message : r.reason) });
  });
  items.sort((a, b) => {
    const da = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const db = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return db - da;
  });
  const seen = new Set();
  const unique = [];
  for (const it of items) {
    const key = (it.title || "").toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }
  const balanced = [];
  const leftover = [];
  const perSource = new Map();
  for (const it of unique) {
    const n = perSource.get(it.sourceId) || 0;
    if (n < 12) {
      balanced.push(it);
      perSource.set(it.sourceId, n + 1);
    } else leftover.push(it);
  }
  newsCache = { at: now, items: balanced.concat(leftover).slice(0, 120), errors };
  return newsCache;
}

function clampStr(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeVisit(body, req, ip, geo) {
  const client = body && typeof body === "object" ? body : {};
  const languages = Array.isArray(client.languages)
    ? client.languages.map((x) => clampStr(x, 20)).filter(Boolean).slice(0, 8)
    : [];
  const screen = client.screen && typeof client.screen === "object" ? client.screen : {};
  const keyboard = client.keyboard && typeof client.keyboard === "object" ? client.keyboard : {};
  const geoGps = client.geolocation && typeof client.geolocation === "object" ? client.geolocation : {};

  return {
    id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: new Date().toISOString(),
    ip,
    geoIp: geo,
    geolocation:
      typeof geoGps.lat === "number" && typeof geoGps.lon === "number"
        ? {
            lat: Number(geoGps.lat.toFixed(5)),
            lon: Number(geoGps.lon.toFixed(5)),
            accuracy: typeof geoGps.accuracy === "number" ? Math.round(geoGps.accuracy) : null,
            source: "navigator.geolocation",
          }
        : null,
    language: clampStr(client.language, 20),
    languages,
    keyboard: {
      layout: clampStr(keyboard.layout, 80),
      sample: clampStr(keyboard.sample, 20),
      api: Boolean(keyboard.api),
    },
    screen: {
      width: Number.isFinite(screen.width) ? Math.round(screen.width) : null,
      height: Number.isFinite(screen.height) ? Math.round(screen.height) : null,
      availWidth: Number.isFinite(screen.availWidth) ? Math.round(screen.availWidth) : null,
      availHeight: Number.isFinite(screen.availHeight) ? Math.round(screen.availHeight) : null,
      colorDepth: Number.isFinite(screen.colorDepth) ? screen.colorDepth : null,
      pixelRatio: Number.isFinite(screen.pixelRatio) ? Number(screen.pixelRatio.toFixed(2)) : null,
      viewportW: Number.isFinite(screen.viewportW) ? Math.round(screen.viewportW) : null,
      viewportH: Number.isFinite(screen.viewportH) ? Math.round(screen.viewportH) : null,
    },
    timezone: clampStr(client.timezone, 60),
    platform: clampStr(client.platform, 80),
    userAgent: clampStr(client.userAgent || req.headers["user-agent"], 350),
    hardwareConcurrency: Number.isFinite(client.hardwareConcurrency) ? client.hardwareConcurrency : null,
    deviceMemory: Number.isFinite(client.deviceMemory) ? client.deviceMemory : null,
    referrer: clampStr(client.referrer, 300),
    acceptLanguage: clampStr(req.headers["accept-language"], 160),
    consent: client.consent === true,
  };
}

function mergeVisit(base, extra) {
  if (!extra) return base;
  if (extra.language) base.language = extra.language;
  if (extra.languages && extra.languages.length) base.languages = extra.languages;
  if (extra.keyboard && extra.keyboard.layout) base.keyboard = extra.keyboard;
  if (extra.screen && extra.screen.width) base.screen = extra.screen;
  if (extra.timezone) base.timezone = extra.timezone;
  if (extra.platform) base.platform = extra.platform;
  if (extra.userAgent) base.userAgent = extra.userAgent;
  if (extra.hardwareConcurrency != null) base.hardwareConcurrency = extra.hardwareConcurrency;
  if (extra.deviceMemory != null) base.deviceMemory = extra.deviceMemory;
  if (extra.referrer) base.referrer = extra.referrer;
  if (extra.geolocation) base.geolocation = extra.geolocation;
  return base;
}

async function recordHit(req, body) {
  const ip = clientIp(req);
  const visits = readVisits();
  const recent = visits.find((v) => v.ip === ip && Date.now() - Date.parse(v.recordedAt) < 180000);
  if (recent) {
    mergeVisit(recent, body ? sanitizeVisit(body, req, ip, recent.geoIp) : null);
    writeVisits(visits);
    return { visit: recent, total: visits.length, merged: true };
  }
  const geo = await geoFromIp(ip);
  const visit = sanitizeVisit(body || { consent: true }, req, ip, geo);
  visits.unshift(visit);
  const next = visits.slice(0, MAX_VISITS);
  writeVisits(next);
  return { visit, total: next.length, merged: false };
}

app.get("/api/me", async (req, res) => {
  const ip = clientIp(req);
  const geo = await geoFromIp(ip);
  res.json({
    ip,
    geo,
    headers: {
      userAgent: req.headers["user-agent"] || null,
      acceptLanguage: req.headers["accept-language"] || null,
      accept: req.headers.accept || null,
      referer: req.headers.referer || null,
    },
    serverTime: new Date().toISOString(),
  });
});

app.get("/api/news", async (req, res) => {
  try {
    const data = await loadNews(req.query.refresh === "1");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.json({
      updatedAt: new Date(data.at).toISOString(),
      sources: FEEDS.map((f) => ({ id: f.id, name: f.name })),
      items: data.items,
      errors: data.errors,
    });
  } catch (err) {
    res.status(502).json({ error: "Impossible de charger les flux RSS", detail: String(err.message || err) });
  }
});

app.post("/api/visit", async (req, res) => {
  const ip = clientIp(req);
  const now = Date.now();
  const prev = lastVisitByIp.get(ip) || 0;
  if (now - prev < VISIT_COOLDOWN_MS) {
    return res.status(429).json({ error: "Patientez quelques secondes avant un nouvel enregistrement." });
  }
  lastVisitByIp.set(ip, now);

  const geo = await geoFromIp(ip);
  const visit = sanitizeVisit(req.body, req, ip, geo);
  const visits = readVisits();
  visits.unshift(visit);
  writeVisits(visits.slice(0, MAX_VISITS));
  res.status(201).json({ ok: true, visit, total: Math.min(visits.length, MAX_VISITS) });
});

app.get("/api/visits", (req, res) => {
  const visits = readVisits();
  res.json({ total: visits.length, file: "data/visits.json", visits });
});

app.delete("/api/visits", (req, res) => {
  writeVisits([]);
  res.json({ ok: true, total: 0 });
});

app.get("/api/visits.json", (req, res) => {
  ensureDataFile();
  res.setHeader("Content-Disposition", "attachment; filename=visits.json");
  res.type("application/json").send(fs.readFileSync(VISITS_FILE, "utf8"));
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

ensureDataFile();
loadNews(true).catch(() => {});

app.listen(PORT, HOST, () => {
  console.log(`Empreinte écoute sur http://${HOST}:${PORT}`);
});
