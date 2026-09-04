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
// Permet de monter un volume persistant : DATA_DIR=/data (Fly.io, Northflank, etc.)
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "data");
const VISITS_FILE = path.join(DATA_DIR, "visits.json");
// La synthèse vit dans son propre fichier : visits.json reste le journal brut,
// intégral et append-only, que rien ne vient encombrer.
const VISITS_SUMMARY_FILE = path.join(DATA_DIR, "visits_summary.json");
const NEWS_CACHE_FILE = path.join(DATA_DIR, "news_cache.json");

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

const crypto = require("crypto");

function cookieValue(req, name) {
  const header = req.headers.cookie || "";
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = header.match(new RegExp("(?:^|;\\s*)" + escaped + "=([^;]*)"));
  return (m && decodeURIComponent(m[1])) || null;
}

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

// ——— Identité d'appareil (cookie propriétaire) ————————————————————
// Indispensable pour distinguer une flotte de terminaux identiques derrière des
// IP tournantes : l'empreinte passive est alors la même pour tous les appareils
// (même modèle, même écran, même GPU) tandis que l'IP change à chaque requête.
// Seul un identifiant déposé par nous-mêmes reste stable dans ce cas.
const DEVICE_COOKIE = "okno-device";
const DEVICE_TTL_MS = 400 * 24 * 60 * 60 * 1000; // ~13 mois

function isValidDeviceId(id) {
  return typeof id === "string" && /^d_[0-9a-f]{32}$/.test(id);
}

function ensureDeviceId(req, res) {
  const existing = cookieValue(req, DEVICE_COOKIE);
  if (isValidDeviceId(existing)) return { deviceId: existing, isNew: false };
  const deviceId = "d_" + crypto.randomBytes(16).toString("hex");
  res.cookie(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: DEVICE_TTL_MS,
    path: "/",
  });
  return { deviceId, isNew: true };
}

app.use((req, res, next) => {
  if (req.method === "GET" && (req.path === "/" || req.path === "/index.html")) {
    const { deviceId, isNew } = ensureDeviceId(req, res);
    recordHit(req, null, deviceId, !isNew).catch((err) => console.error("recordHit", err.message || err));
  }
  next();
});

// ——— Auth ———
const AUTH_FILE = path.join(DATA_DIR, "users.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const AUTH_COOKIE = "okno-session";
const AUTH_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

function ensureAuthFile() {
  if (!fs.existsSync(AUTH_FILE)) {
    fs.writeFileSync(AUTH_FILE, "[]", "utf8");
  }
}

function readUsers() {
  ensureAuthFile();
  try {
    const raw = fs.readFileSync(AUTH_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureAuthFile();
  const tmp = AUTH_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, AUTH_FILE);
}

function sha256(str, salt) {
  return crypto.createHash("sha256").update(str + salt).digest("hex");
}

// ——— Schéma de hachage (identique à la version PHP) ———
// Le navigateur envoie H1 = sha256(mot_de_passe + sel) ; le serveur stocke
// H2 = sha256(H1 + sel). Le mot de passe en clair ne transite jamais.
const AUTH_SCHEME = 2;
const SALT_RE = /^[A-Za-z0-9._-]{1,64}$/;
const CLIENT_HASH_RE = /^[a-f0-9]{64}$/;

function hashFromClient(clientHash, salt) {
  return sha256(clientHash, salt);
}

// Sel de substitution pour un login inconnu : évite l'énumération de comptes.
function decoySalt(login) {
  return sha256("okno-decoy|" + String(login).trim().toLowerCase(), "").slice(0, 16);
}

// Sel déjà stocké : les comptes créés avant dérivaient le sel du login
// (« jean marc-m1abc »), espaces et cyrillique compris — on ne peut donc pas
// leur imposer le format strict sans casser leur connexion.
function saltIsUsable(salt) {
  return typeof salt === "string" && salt.length > 0 && salt.length <= 64 && !/[\u0000-\u001f\u007f]/.test(salt);
}

function timingSafeEqualHex(a, b) {
  const x = String(a || "");
  const y = String(b || "");
  if (x.length !== y.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(x, "hex"), Buffer.from(y, "hex"));
  } catch {
    return false;
  }
}

// Refus systématique du mot de passe en clair (ancienne copie de auth.js en cache).
function rejectCleartext(body, res) {
  if (body && typeof body.password === "string" && body.password !== "") {
    res.status(400).json({
      ok: false,
      error: "Старая версия скрипта входа. Обновите страницу (Ctrl+F5) и попробуйте снова.",
      reason: "cleartext-password",
    });
    return true;
  }
  return false;
}

function genSessionId() {
  return "okno-" + crypto.randomBytes(18).toString("hex");
}

function loadSessionStore() {
  try {
    const raw = fs.readFileSync(SESSIONS_FILE, "utf8");
    const map = JSON.parse(raw);
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

function writeSessionStore(store) {
  ensureDataFile();
  const tmp = SESSIONS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, SESSIONS_FILE);
}

function sessionUser(req) {
  const sid = cookieValue(req, AUTH_COOKIE);
  if (!sid) return null;
  const store = loadSessionStore();
  const sess = store[sid];
  if (!sess || Date.now() - (sess.created || 0) > AUTH_TTL_MS) return null;
  const users = readUsers();
  return users.find((u) => u.id === sess.userId) || null;
}

// Le tableau de bord est protégé : sans session valide, redirection vers la
// page de connexion. Déclaré avant express.static pour que le fichier
// public/dashboard.html ne soit jamais servi sans authentification.
app.get(["/dashboard.html", "/dashboard"], (req, res) => {
  if (!sessionUser(req)) {
    res.redirect("/auth/login.html");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(fs.readFileSync(path.join(__dirname, "public", "dashboard.html"), "utf8"));
});

// Legacy URLs -> new canonical pages (renamed)
app.use((req, res, next) => {
  const pathLower = String(req.path || "").toLowerCase();
  if (pathLower === "/confidentialite.html" || pathLower === "/confidentialite") {
    return res.redirect(301, "/confidentiality.html");
  }
  if (pathLower === "/informations-juridiques.html" || pathLower === "/informations-juridiques") {
    return res.redirect(301, "/Legal-information.html");
  }
  if (pathLower === "/legal-information.html" && req.path !== "/Legal-information.html") {
    return res.redirect(301, "/Legal-information.html");
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
  if (!fs.existsSync(VISITS_SUMMARY_FILE)) {
    fs.writeFileSync(
      VISITS_SUMMARY_FILE,
      JSON.stringify(buildSummaryFile([]), null, 2) + "\n",
      "utf8"
    );
  }
}

// visits.json : le journal brut, un tableau de visites, rien d'autre.
function readVisits() {
  ensureDataFile();
  try {
    const raw = fs.readFileSync(VISITS_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    // Tolère la version précédente, où la synthèse était logée dans le journal.
    if (data && Array.isArray(data.visits)) return data.visits;
    return [];
  } catch {
    return [];
  }
}

function writeJsonAtomic(file, payload) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

// Écrit le journal PUIS régénère la synthèse : les deux fichiers ne peuvent pas
// diverger, la synthèse étant toujours dérivée du journal qu'on vient d'écrire.
function writeVisits(visits) {
  ensureDataFile();
  const list = Array.isArray(visits) ? visits : [];
  writeJsonAtomic(VISITS_FILE, list);
  const summary = buildSummaryFile(list);
  writeJsonAtomic(VISITS_SUMMARY_FILE, summary);
  return summary;
}

// Relit la synthèse sur disque ; la recalcule si le fichier manque ou date d'un
// journal plus récent (édition manuelle, restauration, montée de version).
function readSummaryFile() {
  ensureDataFile();
  const visits = readVisits();
  try {
    const raw = fs.readFileSync(VISITS_SUMMARY_FILE, "utf8");
    const cached = JSON.parse(raw);
    if (cached && cached.summary && cached.summary.totalVisits === visits.length) {
      return cached;
    }
  } catch {
    /* pas de synthèse exploitable : on la reconstruit */
  }
  const rebuilt = buildSummaryFile(visits);
  try {
    writeJsonAtomic(VISITS_SUMMARY_FILE, rebuilt);
  } catch {
    /* disque en lecture seule : la synthèse reste servie en mémoire */
  }
  return rebuilt;
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
  const repl = (sample.match(/\uFFFD/g) || []).length;
  return cyr < 10 || repl > 4;
}

function isValidUtf8(buf) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function cyrillicScore(text) {
  const sample = String(text || "").slice(0, 6000);
  const cyr = (sample.match(/[А-Яа-яЁё]/g) || []).length;
  const repl = (sample.match(/\uFFFD/g) || []).length;
  return cyr - 5 * repl;
}

/*
 * Décode un flux RSS en UTF-8 de façon robuste :
 * 1. si les octets sont de l'UTF-8 valide, l'UTF-8 gagne toujours — même si
 *    l'en-tête HTTP ou la déclaration XML annonce autre chose (source classique
 *    des caractères cassés) ;
 * 2. sinon on essaie le jeu déclaré puis windows-1251 / koi8-r, et on garde le
 *    décodage qui donne le plus de lettres cyrilliques et le moins de U+FFFD.
 */
function decodeFeedBuffer(buf, declaredCharset) {
  if (isValidUtf8(buf)) {
    const text = iconv.decode(buf, "utf-8").replace(/^\uFEFF/, "");
    if (!looksBrokenCyrillic(text) || declaredCharset === "utf-8" || !declaredCharset) {
      return text;
    }
  }
  const candidates = [];
  for (const cs of [declaredCharset, "win1251", "koi8-r", "utf-8"]) {
    if (cs && !candidates.includes(cs)) candidates.push(cs);
  }
  let best = null;
  for (const cs of candidates) {
    let text;
    try {
      text = iconv.decode(buf, cs);
    } catch {
      continue;
    }
    const score = cyrillicScore(text);
    if (!best || score > best.score) best = { text, score };
  }
  return (best ? best.text : iconv.decode(buf, "utf-8")).replace(/^\uFEFF/, "");
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
  const xml = decodeFeedBuffer(buf, charsetOf(res.headers.get("content-type"), headAscii));
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

function readDiskCache() {
  try {
    const raw = fs.readFileSync(NEWS_CACHE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.items)) return data;
  } catch {}
  return null;
}

function writeDiskCache(items, errors) {
  try {
    ensureDataFile();
    const tmp = NEWS_CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ at: Date.now(), items, errors }) + "\n", "utf8");
    fs.renameSync(tmp, NEWS_CACHE_FILE);
  } catch (err) {
    console.error("writeDiskCache", err.message || err);
  }
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
  const merged = balanced.concat(leftover).slice(0, 120);
  if (merged.length) {
    writeDiskCache(merged, errors);
    newsCache = { at: now, items: merged, errors };
    return newsCache;
  }
  // Aucun flux joignable : sert le dernier instantané propre enregistré sur
  // disque (toujours UTF-8) plutôt qu'une page vide. On re-nettoie les champs
  // texte au passage (entités HTML résiduelles type &#34;).
  const disk = readDiskCache();
  if (disk && disk.items.length) {
    const cleaned = disk.items.slice(0, 120).map((it) => ({
      ...it,
      title: decodeEntities(it.title) || "(sans titre)",
      summary: it.summary ? decodeEntities(it.summary) : null,
      category: it.category ? decodeEntities(it.category) : null,
    }));
    newsCache = { at: now, items: cleaned, errors };
    return newsCache;
  }
  newsCache = { at: now, items: [], errors };
  return newsCache;
}

function clampStr(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function parseAcceptLanguage(header) {
  if (!header) return [];
  return String(header)
    .split(",")
    .map((part) => part.split(";")[0].trim())
    .filter(Boolean)
    .slice(0, 8);
}

function platformFromUa(ua) {
  const s = String(ua || "");
  if (/Windows NT 10/i.test(s)) return "Windows 10/11";
  if (/Windows/i.test(s)) return "Windows";
  if (/Mac OS X/i.test(s)) return "macOS";
  if (/Android/i.test(s)) return "Android";
  if (/iPhone|iPad/i.test(s)) return "iOS";
  if (/Linux/i.test(s)) return "Linux";
  return null;
}

function sanitizeHints(raw) {
  const h = raw && typeof raw === "object" ? raw : {};
  const brands = Array.isArray(h.brands)
    ? h.brands.map((x) => clampStr(x, 60)).filter(Boolean).slice(0, 8)
    : [];
  const full = Array.isArray(h.fullVersionList)
    ? h.fullVersionList.map((x) => clampStr(x, 80)).filter(Boolean).slice(0, 8)
    : [];
  return {
    available: Boolean(h.available),
    mobile: typeof h.mobile === "boolean" ? h.mobile : null,
    platform: clampStr(h.platform, 40),
    platformVersion: clampStr(h.platformVersion, 40),
    architecture: clampStr(h.architecture, 20),
    bitness: clampStr(h.bitness, 8),
    model: clampStr(h.model, 60),
    uaFullVersion: clampStr(h.uaFullVersion, 40),
    brands,
    fullVersionList: full,
    wow64: typeof h.wow64 === "boolean" ? h.wow64 : null,
  };
}

function sanitizeVisit(body, req, ip, geo, deviceId, deviceConfirmed) {
  const client = body && typeof body === "object" ? body : {};
  const languages = Array.isArray(client.languages)
    ? client.languages.map((x) => clampStr(x, 20)).filter(Boolean).slice(0, 8)
    : [];
  const screen = client.screen && typeof client.screen === "object" ? client.screen : {};
  const keyboard = client.keyboard && typeof client.keyboard === "object" ? client.keyboard : {};
  const geoGps = client.geolocation && typeof client.geolocation === "object" ? client.geolocation : {};
  const theme = client.theme && typeof client.theme === "object" ? client.theme : {};
  const network = client.network && typeof client.network === "object" ? client.network : {};
  const gpu = client.gpu && typeof client.gpu === "object" ? client.gpu : {};
  const voices = client.voices && typeof client.voices === "object" ? client.voices : {};
  const intl = client.intl && typeof client.intl === "object" ? client.intl : {};
  const storage = client.storage && typeof client.storage === "object" ? client.storage : {};
  const fromHeader = parseAcceptLanguage(req.headers["accept-language"]);

  return {
    id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    recordedAt: new Date().toISOString(),
    deviceId: isValidDeviceId(deviceId) ? deviceId : null,
    // true : le navigateur nous a REPRÉSENTÉ le cookie, il le conserve donc.
    // false : cookie tout juste émis, sa persistance n'est pas encore prouvée.
    deviceConfirmed: isValidDeviceId(deviceId) ? deviceConfirmed === true : false,
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
    language: clampStr(client.language, 20) || fromHeader[0] || null,
    languages: languages.length ? languages : fromHeader,
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
      outerW: Number.isFinite(screen.outerW) ? Math.round(screen.outerW) : null,
      outerH: Number.isFinite(screen.outerH) ? Math.round(screen.outerH) : null,
      orientation: clampStr(screen.orientation, 40),
    },
    timezone: clampStr(client.timezone, 60) || (geo && geo.timezone) || null,
    platform: clampStr(client.platform, 80) || platformFromUa(client.userAgent || req.headers["user-agent"]),
    userAgent: clampStr(client.userAgent || req.headers["user-agent"], 350),
    hardwareConcurrency: Number.isFinite(client.hardwareConcurrency) ? client.hardwareConcurrency : null,
    deviceMemory: Number.isFinite(client.deviceMemory) ? client.deviceMemory : null,
    maxTouchPoints: Number.isFinite(client.maxTouchPoints) ? client.maxTouchPoints : null,
    referrer: clampStr(client.referrer, 300),
    acceptLanguage: clampStr(req.headers["accept-language"], 160),
    cookiesEnabled: typeof client.cookiesEnabled === "boolean" ? client.cookiesEnabled : null,
    globalPrivacyControl: typeof client.globalPrivacyControl === "boolean" ? client.globalPrivacyControl : null,
    pdfViewerEnabled: typeof client.pdfViewerEnabled === "boolean" ? client.pdfViewerEnabled : null,
    webdriver: typeof client.webdriver === "boolean" ? client.webdriver : null,
    clientHints: sanitizeHints(client.clientHints),
    theme: {
      colorScheme: clampStr(theme.colorScheme, 20),
      reducedMotion: typeof theme.reducedMotion === "boolean" ? theme.reducedMotion : null,
      pointer: clampStr(theme.pointer, 20),
      hover: typeof theme.hover === "boolean" ? theme.hover : null,
      colorGamut: clampStr(theme.colorGamut, 12),
    },
    network: {
      type: clampStr(network.type, 20),
      effectiveType: clampStr(network.effectiveType, 12),
      downlink: Number.isFinite(network.downlink) ? Number(network.downlink.toFixed(2)) : null,
      rtt: Number.isFinite(network.rtt) ? Math.round(network.rtt) : null,
      saveData: typeof network.saveData === "boolean" ? network.saveData : null,
    },
    gpu: {
      vendor: clampStr(gpu.vendor, 120),
      renderer: clampStr(gpu.renderer, 180),
    },
    voices: {
      count: Number.isFinite(voices.count) ? voices.count : null,
      langs: Array.isArray(voices.langs)
        ? voices.langs.map((x) => clampStr(x, 20)).filter(Boolean).slice(0, 20)
        : [],
      names: Array.isArray(voices.names)
        ? voices.names.map((x) => clampStr(x, 80)).filter(Boolean).slice(0, 16)
        : [],
    },
    intl: {
      locale: clampStr(intl.locale, 30),
      calendar: clampStr(intl.calendar, 30),
      numberingSystem: clampStr(intl.numberingSystem, 20),
      timeZone: clampStr(intl.timeZone, 60),
    },
    storage: {
      quotaMB: Number.isFinite(storage.quotaMB) ? storage.quotaMB : null,
      usageMB: Number.isFinite(storage.usageMB) ? storage.usageMB : null,
    },
    consent: client.consent === true,
  };
}

function mergeVisit(base, extra) {
  if (!extra) return base;
  const keys = [
    "language",
    "languages",
    "keyboard",
    "screen",
    "timezone",
    "platform",
    "userAgent",
    "hardwareConcurrency",
    "deviceMemory",
    "maxTouchPoints",
    "referrer",
    "cookiesEnabled",
    "globalPrivacyControl",
    "pdfViewerEnabled",
    "webdriver",
    "clientHints",
    "theme",
    "network",
    "gpu",
    "voices",
    "intl",
    "storage",
    "geolocation",
  ];
  for (const k of keys) {
    const v = extra[k];
    if (v == null) continue;
    if (Array.isArray(v) && !v.length) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const useful = Object.values(v).some((x) => x != null && x !== false && !(Array.isArray(x) && !x.length));
      if (!useful) continue;
      base[k] = Object.assign({}, base[k] || {}, v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

// ——— Synthèse des visiteurs ———————————————————————————————————————
// visits.json ne contient plus seulement la liste brute des visites : on y
// ajoute une fiche par « client » (empreinte stable) et un résumé global, tous
// deux recalculés à chaque écriture à partir des seules données déjà
// enregistrées par le navigateur (aucune collecte supplémentaire).

function deviceType(v) {
  const ua = String(v.userAgent || "");
  const hints = v.clientHints || {};
  const isTablet =
    /iPad|Tablet|PlayBook|Silk/i.test(ua) ||
    (/Android/i.test(ua) && !/Mobile/i.test(ua)) ||
    (v.platform === "MacIntel" && Number(v.maxTouchPoints) > 1);
  if (isTablet) return "tablet";
  if (hints.mobile === true || /Mobi|iPhone|Android/i.test(ua)) return "mobile";
  return "desktop";
}

function browserName(v) {
  const hints = v.clientHints || {};
  const brands = [].concat(hints.fullVersionList || [], hints.brands || []);
  const real = brands.find((b) => !/Not.?A.?Brand/i.test(b) && !/Chromium/i.test(b));
  if (real) return clampStr(real, 60);
  const ua = String(v.userAgent || "");
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/YaBrowser/.test(ua)) return "Yandex";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return null;
}

function osName(v) {
  const hints = v.clientHints || {};
  if (hints.platform) {
    return clampStr(hints.platform + (hints.platformVersion ? " " + hints.platformVersion : ""), 60);
  }
  return clampStr(v.platform || platformFromUa(v.userAgent), 60);
}

// Identité d'un client, par ordre de fiabilité décroissante.
//
// 1. deviceId — cookie propriétaire déposé par nous. Seul identifiant fiable
//    quand plusieurs terminaux identiques se présentent derrière des IP
//    tournantes : l'empreinte passive ne les distingue pas, l'IP ne les suit
//    pas. C'est le cas d'une flotte de téléphones du même modèle.
// 2. Empreinte SANS l'IP — pour les visiteurs qui refusent les cookies. Une IP
//    qui tourne ne fragmente alors plus le comptage, mais deux appareils
//    identiques restent confondus : le regroupement est marqué « approximatif ».
//
// L'IP n'entre jamais dans la clé : elle change trop vite (mobile, VPN, CGNAT)
// et gonflait artificiellement le nombre de clients.
function fingerprintKey(v) {
  const s = v.screen || {};
  const parts = [
    osName(v) || "",
    browserName(v) || "",
    deviceType(v),
    s.width || "",
    s.height || "",
    s.colorDepth || "",
    s.pixelRatio || "",
    v.timezone || "",
    v.language || "",
    v.hardwareConcurrency || "",
    v.deviceMemory || "",
    (v.gpu && v.gpu.renderer) || "",
  ].join("|");
  return crypto.createHash("sha256").update(parts).digest("hex").slice(0, 16);
}

// `confirmed` : ensemble des deviceId que le navigateur nous a rendus au moins
// une fois. Un cookie jamais représenté (terminal qui les refuse) est ignoré :
// sinon chaque visite créerait un client fantôme.
function clientKey(v, confirmed) {
  if (isValidDeviceId(v.deviceId) && (!confirmed || confirmed.has(v.deviceId))) {
    return "c_" + v.deviceId.slice(2);
  }
  return "fp_" + fingerprintKey(v);
}

// « device » : identité certaine (un cookie = un appareil).
// « fingerprint » : regroupement approximatif, des appareils identiques peuvent
// être confondus et un même appareil peut se dédoubler s'il efface ses cookies.
function identityMode(v, confirmed) {
  return isValidDeviceId(v.deviceId) && (!confirmed || confirmed.has(v.deviceId))
    ? "device"
    : "fingerprint";
}

function topOf(counter, limit = 5) {
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function bump(counter, key) {
  if (key == null || key === "") return;
  counter[key] = (counter[key] || 0) + 1;
}

function summarizeClient(visits, confirmed) {
  const sorted = visits.slice().sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  const last = sorted[sorted.length - 1];
  const first = sorted[0];
  const geo = last.geoIp || {};
  const days = new Set(sorted.map((v) => String(v.recordedAt || "").slice(0, 10)).filter(Boolean));
  const referrers = {};
  const languages = {};
  for (const v of sorted) {
    if (v.referrer) bump(referrers, v.referrer);
    bump(languages, v.language);
  }
  const spanMs = Date.parse(last.recordedAt) - Date.parse(first.recordedAt);
  const ips = new Set(sorted.map((v) => v.ip).filter(Boolean));
  return {
    clientId: clientKey(last, confirmed),
    identity: identityMode(last, confirmed),
    identityNote:
      identityMode(last, confirmed) === "device"
        ? "cookie propriétaire : un appareil distinct, même si son IP change"
        : "empreinte sans IP : des appareils identiques peuvent être confondus",
    visits: sorted.length,
    distinctDays: days.size,
    firstSeen: first.recordedAt || null,
    lastSeen: last.recordedAt || null,
    returning: sorted.length > 1,
    daysBetweenFirstAndLast: Number.isFinite(spanMs) ? Number((spanMs / 86400000).toFixed(2)) : null,
    ip: last.ip || null,
    distinctIps: ips.size,
    rotatingIp: ips.size > 1,
    place: {
      city: geo.city || null,
      region: geo.region || null,
      country: geo.country || null,
      countryCode: geo.countryCode || null,
      isp: geo.isp || null,
    },
    gpsShared: sorted.some((v) => v.geolocation != null),
    device: {
      type: deviceType(last),
      os: osName(last),
      browser: browserName(last),
      screen:
        last.screen && last.screen.width && last.screen.height
          ? `${last.screen.width}×${last.screen.height}`
          : null,
      gpu: (last.gpu && last.gpu.renderer) || null,
      cores: last.hardwareConcurrency ?? null,
      memoryGB: last.deviceMemory ?? null,
      touch: Number(last.maxTouchPoints) > 0,
    },
    preferences: {
      language: last.language || null,
      languages: Array.isArray(last.languages) ? last.languages : [],
      timezone: last.timezone || null,
      colorScheme: (last.theme && last.theme.colorScheme) || null,
      reducedMotion: (last.theme && last.theme.reducedMotion) ?? null,
      keyboardLayout: (last.keyboard && last.keyboard.layout) || null,
    },
    network: {
      effectiveType: (last.network && last.network.effectiveType) || null,
      downlink: (last.network && last.network.downlink) ?? null,
      rtt: (last.network && last.network.rtt) ?? null,
      saveData: (last.network && last.network.saveData) ?? null,
    },
    privacy: {
      cookiesEnabled: last.cookiesEnabled ?? null,
      globalPrivacyControl: last.globalPrivacyControl ?? null,
      consent: last.consent === true,
      automated: last.webdriver === true,
    },
    referrers: topOf(referrers, 5),
    languagesSeen: topOf(languages, 5),
    visitIds: sorted.map((v) => v.id).filter(Boolean).slice(-50),
  };
}

function buildSummaryFile(visits) {
  const list = Array.isArray(visits) ? visits : [];
  // Un cookie ne compte que si le navigateur l'a représenté au moins une fois.
  const confirmed = new Set();
  for (const v of list) {
    if (v && v.deviceConfirmed === true && isValidDeviceId(v.deviceId)) confirmed.add(v.deviceId);
  }
  const groups = new Map();
  for (const v of list) {
    if (!v || typeof v !== "object") continue;
    const key = clientKey(v, confirmed);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(v);
  }
  const clients = [...groups.values()]
    .map((g) => summarizeClient(g, confirmed))
    .sort((a, b) => Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0));

  const countries = {};
  const cities = {};
  const devices = {};
  const browsers = {};
  const systems = {};
  const langs = {};
  const timezones = {};
  const referrers = {};
  const hours = {};
  for (const c of clients) {
    bump(countries, c.place.country);
    bump(cities, [c.place.city, c.place.country].filter(Boolean).join(", "));
    bump(devices, c.device.type);
    bump(browsers, c.device.browser);
    bump(systems, c.device.os);
    bump(langs, c.preferences.language);
    bump(timezones, c.preferences.timezone);
    for (const r of c.referrers) referrers[r.value] = (referrers[r.value] || 0) + r.count;
  }
  for (const v of list) {
    const d = new Date(v.recordedAt);
    if (!Number.isNaN(d.getTime())) bump(hours, String(d.getUTCHours()).padStart(2, "0") + "h");
  }
  const returning = clients.filter((c) => c.returning).length;
  const stamps = list.map((v) => Date.parse(v.recordedAt)).filter((n) => Number.isFinite(n));
  const dayKeys = new Set(list.map((v) => String(v.recordedAt || "").slice(0, 10)).filter(Boolean));

  return {
    generatedAt: new Date().toISOString(),
    source: "data/visits.json",
    summary: {
      totalVisits: list.length,
      uniqueClients: clients.length,
      returningClients: returning,
      newClients: clients.length - returning,
      returningRate: clients.length ? Number((returning / clients.length).toFixed(3)) : 0,
      visitsPerClient: clients.length ? Number((list.length / clients.length).toFixed(2)) : 0,
      activeDays: dayKeys.size,
      firstVisitAt: stamps.length ? new Date(Math.min(...stamps)).toISOString() : null,
      lastVisitAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
      gpsShared: clients.filter((c) => c.gpsShared).length,
      automated: clients.filter((c) => c.privacy.automated).length,
      identifiedByCookie: clients.filter((c) => c.identity === "device").length,
      identifiedByFingerprint: clients.filter((c) => c.identity === "fingerprint").length,
      clientsWithRotatingIp: clients.filter((c) => c.rotatingIp).length,
      topCountries: topOf(countries),
      topCities: topOf(cities),
      topDevices: topOf(devices),
      topBrowsers: topOf(browsers),
      topSystems: topOf(systems),
      topLanguages: topOf(langs),
      topTimezones: topOf(timezones),
      topReferrers: topOf(referrers),
      visitsByHourUTC: topOf(hours, 24).sort((a, b) => a.value.localeCompare(b.value)),
    },
    clients,
  };
}

async function recordHit(req, body, deviceId, deviceConfirmed) {
  const ip = clientIp(req);
  const visits = readVisits();
  // Fusion des doublons quasi simultanés : on suit l'appareil quand on le
  // connaît (l'IP peut changer d'une requête à l'autre sur mobile).
  const recent = visits.find((v) => {
    const fresh = Date.now() - Date.parse(v.recordedAt) < 180000;
    if (!fresh) return false;
    if (isValidDeviceId(deviceId)) return v.deviceId === deviceId;
    return !v.deviceId && v.ip === ip;
  });
  if (recent) {
    mergeVisit(recent, body ? sanitizeVisit(body, req, ip, recent.geoIp, deviceId, deviceConfirmed) : null);
    writeVisits(visits);
    return { visit: recent, total: visits.length, merged: true };
  }
  const geo = await geoFromIp(ip);
  const visit = sanitizeVisit(body || { consent: true }, req, ip, geo, deviceId, deviceConfirmed);
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
  const { deviceId, isNew } = ensureDeviceId(req, res);
  const visit = sanitizeVisit(req.body, req, ip, geo, deviceId, !isNew);
  const visits = readVisits();
  visits.unshift(visit);
  const saved = writeVisits(visits.slice(0, MAX_VISITS));
  res.status(201).json({
    ok: true,
    visit,
    total: Math.min(visits.length, MAX_VISITS),
    summary: saved.summary,
  });
});

app.get("/api/visits", (req, res) => {
  const visits = readVisits();
  const file = readSummaryFile();
  res.json({
    total: visits.length,
    file: "data/visits.json",
    summaryFile: "data/visits_summary.json",
    generatedAt: file.generatedAt,
    summary: file.summary,
    clients: file.clients,
    visits,
  });
});

// Synthèse seule : utile pour un tableau de bord sans transporter tout le journal.
app.get("/api/visits/summary", (req, res) => {
  const file = readSummaryFile();
  res.json({
    file: "data/visits_summary.json",
    source: "data/visits.json",
    generatedAt: file.generatedAt,
    summary: file.summary,
    clients: file.clients,
  });
});

app.delete("/api/visits", (req, res) => {
  writeVisits([]);
  res.json({ ok: true, total: 0 });
});

// Téléchargement du journal brut, tel qu'il est sur le disque.
app.get("/api/visits.json", (req, res) => {
  ensureDataFile();
  res.setHeader("Content-Disposition", "attachment; filename=visits.json");
  res.type("application/json").send(fs.readFileSync(VISITS_FILE, "utf8"));
});

// Téléchargement de la synthèse (fichier séparé).
app.get("/api/visits_summary.json", (req, res) => {
  const file = readSummaryFile();
  res.setHeader("Content-Disposition", "attachment; filename=visits_summary.json");
  res.type("application/json").send(JSON.stringify(file, null, 2) + "\n");
});

app.get("/api/auth/me", (req, res) => {
  const user = sessionUser(req);
  if (!user) {
    return res.json({ ok: false, user: null });
  }
  res.json({
    ok: true,
    user: { id: user.id, login: user.login, role: user.role, createdAt: user.createdAt || null },
  });
});

app.get("/api/auth/challenge", (req, res) => {
  const login = String((req.query && req.query.login) || "").trim();
  if (!login || login.length > 40) {
    return res.json({ ok: true, salt: decoySalt(login), scheme: AUTH_SCHEME });
  }
  const users = readUsers();
  const user = users.find((u) => u.login.toLowerCase() === login.toLowerCase());
  if (!user || !saltIsUsable(user.salt)) {
    return res.json({ ok: true, salt: decoySalt(login), scheme: AUTH_SCHEME });
  }
  res.json({ ok: true, salt: user.salt, scheme: AUTH_SCHEME });
});

app.post("/api/auth/login", (req, res) => {
  const body = req.body || {};
  if (rejectCleartext(body, res)) return;
  const login = String(body.login || "").trim();
  const hash = String(body.hash || "").trim().toLowerCase();
  if (!login || !hash) {
    return res.status(400).json({ ok: false, error: "Заполните логин и пароль." });
  }
  if (!CLIENT_HASH_RE.test(hash)) {
    return res.status(400).json({
      ok: false,
      error: "Неверный формат данных входа. Обновите страницу (Ctrl+F5).",
      reason: "bad-hash-format",
    });
  }
  const users = readUsers();
  const idx = users.findIndex((u) => u.login.toLowerCase() === login.toLowerCase());
  if (idx < 0) {
    return res.status(401).json({ ok: false, error: "Неверный логин или пароль." });
  }
  const user = users[idx];
  const expected = hashFromClient(hash, user.salt || "");
  let migrated = false;
  if (timingSafeEqualHex(expected, user.hash)) {
    // schéma courant
  } else if (timingSafeEqualHex(hash, user.hash)) {
    // ancien schéma (H1 stocké tel quel) : migration sans mot de passe en clair
    users[idx] = Object.assign({}, user, {
      hash: expected,
      scheme: AUTH_SCHEME,
      migratedAt: new Date().toISOString(),
    });
    writeUsers(users);
    migrated = true;
  } else {
    return res.status(401).json({ ok: false, error: "Неверный логин или пароль." });
  }
  const store = loadSessionStore();
  const sid = genSessionId();
  store[sid] = { userId: user.id, created: Date.now() };
  writeSessionStore(store);
  res.cookie(AUTH_COOKIE, sid, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: AUTH_TTL_MS, // millisecondes — express convert en secondes tout seul
    path: "/",
  });
  res.json({ ok: true, user: { id: user.id, login: user.login, role: user.role }, migrated });
});

app.post("/api/auth/register", (req, res) => {
  const body = req.body || {};
  if (rejectCleartext(body, res)) return;
  const login = String(body.login || "").trim();
  const hash = String(body.hash || "").trim().toLowerCase();
  const salt = String(body.salt || "").trim();
  if (!login || !hash || !salt) {
    return res.status(400).json({ ok: false, error: "Укажите логин и пароль." });
  }
  if (!CLIENT_HASH_RE.test(hash)) {
    return res.status(400).json({
      ok: false,
      error: "Неверный формат данных регистрации. Обновите страницу (Ctrl+F5).",
      reason: "bad-hash-format",
    });
  }
  if (!SALT_RE.test(salt)) {
    return res.status(400).json({ ok: false, error: "Неверный формат соли." });
  }
  if (login.length < 3 || login.length > 40) {
    return res.status(400).json({ ok: false, error: "Логин от 3 до 40 знаков." });
  }
  const users = readUsers();
  if (users.find((u) => u.login.toLowerCase() === login.toLowerCase())) {
    return res.status(409).json({ ok: false, error: "Этот логин уже занят." });
  }
  const newUser = {
    id: "u_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6),
    login,
    hash: hashFromClient(hash, salt),
    salt,
    scheme: AUTH_SCHEME,
    createdAt: new Date().toISOString(),
    role: "reader",
  };
  users.push(newUser);
  writeUsers(users);
  res.status(201).json({ ok: true, user: { id: newUser.id, login: newUser.login, role: newUser.role } });
});

app.post("/api/auth/logout", (req, res) => {
  const sid = cookieValue(req, AUTH_COOKIE);
  if (sid) {
    const store = loadSessionStore();
    delete store[sid];
    writeSessionStore(store);
  }
  res.clearCookie(AUTH_COOKIE, { path: "/" });
  res.json({ ok: true });
});

// ——— Contenu éditorial : la bande (flux) et les messages de la rédaction ———
//
// Deux publics, deux droits :
//   • editor  = rôle administrateur du projet : il gère la bande (les flux,
//     leurs sources) ET les messages affichés aux utilisateurs ;
//   • reader  = utilisateur : il ne voit que les messages publiés par la
//     rédaction. Les dépêches, leurs sources et leurs liens ne transitent
//     jamais vers son tableau de bord (voir public/dashboard.js).
//
// Commenter (/api/comments), en revanche, est ouvert à tout utilisateur
// connecté — lecteur comme éditeur. Écrire (messages ou bande) reste réservé
// à la rédaction.
//
// Les libellés de rôle ne sont pas renvoyés par le serveur : le client traduit
// « reader » / « editor » lui-même (window.OKNO.roleLabel).
const DISPATCHES_FILE = path.join(DATA_DIR, "dispatches.json");
const MESSAGES_FILE = path.join(DATA_DIR, "messages.json");
const COMMENTS_FILE = path.join(DATA_DIR, "comments.json");
const ADMIN_ROLES = new Set(["editor", "admin"]);
const MAX_MESSAGES = 80;
const MAX_DISPATCHES = 200;
const MAX_COMMENTS = 1000;

function isAdminUser(user) {
  return !!user && ADMIN_ROLES.has(String(user.role || "reader").toLowerCase());
}

// Écriture atomique commune aux deux fichiers de contenu.
function writeJsonFile(file, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function readJsonFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function readDispatches() {
  return readJsonFile(DISPATCHES_FILE);
}

function readMessages() {
  return readJsonFile(MESSAGES_FILE);
}

function readComments() {
  return readJsonFile(COMMENTS_FILE);
}

// ——— Sanitisation ———
function clampText(v, max) {
  if (v === null || v === undefined) return "";
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Un champ bilingue accepte { ru, en } ou une chaîne simple : une valeur isolée
// est rangée en « ru », le client retombant sur l'autre langue si une manque.
function clampLang(v, max) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return { ru: clampText(v.ru, max), en: clampText(v.en, max) };
  }
  const s = clampText(v, max);
  return { ru: s, en: "" };
}

// Un des deux textes seulement suffit : la version de secours est l'autre langue.
function hasText(field) {
  return !!(field && (field.ru || field.en));
}

function safeUrl(v, max) {
  const s = clampText(v, max);
  if (!s || s === "#") return s || null;
  if (!/^(https?:)?\/\//i.test(s) && !s.startsWith("/")) return null;
  return s;
}

function safeIsoDate(v) {
  const s = clampText(v, 40);
  const t = s ? Date.parse(s) : NaN;
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

/**
 * Message : champs reconstruits à partir de l'existant quand une requête n'en
 * porte qu'une partie (c'est le cas de « publier / retirer »).
 */
function sanitizeMessage(input, existing) {
  const base = existing || {};
  return {
    title: clampLang(input.title !== undefined ? input.title : base.title, 160),
    body: clampLang(input.body !== undefined ? input.body : base.body, 1400),
    active: input.active !== undefined ? input.active !== false && input.active !== "false" : base.active !== false,
    author: clampText(input.author !== undefined ? input.author : base.author, 40),
  };
}

/**
 * Commentaire d'un lecteur ou de la rédaction sur un message. Le corps est un
 * texte libre, pas bilingue : chacun écrit dans la langue qu'il veut.
 */
function sanitizeComment(input) {
  return {
    messageId: clampText(input && input.messageId, 40),
    body: clampText(input && input.body, 600),
  };
}

function sanitizeDispatch(input, existing) {
  const base = existing || {};
  const pick = (key, max) => clampText(input[key] !== undefined ? input[key] : base[key], max);
  const out = {
    category: pick("category", 60),
    source: pick("source", 60),
    sourceId: pick("sourceId", 40).toLowerCase().replace(/[^a-z0-9._-]/g, "") || null,
    // Conserver les deux versions quand elles sont fournies par l'éditeur.
    // Une chaîne historique est rangée en russe et reste compatible avec le
    // repli de l'interface.
    title: clampLang(input.title !== undefined ? input.title : base.title, 240),
    summary: clampLang(input.summary !== undefined ? input.summary : base.summary, 900),
    link: safeUrl(input.link !== undefined ? input.link : base.link, 400),
    image: safeUrl(input.image !== undefined ? input.image : base.image, 400),
    publishedAt:
      input.publishedAt !== undefined
        ? safeIsoDate(input.publishedAt)
        : clampText(base.publishedAt, 40) || new Date().toISOString(),
  };
  if (!out.sourceId && out.source) {
    out.sourceId = out.source.toLowerCase().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || null;
  }
  return out;
}

/** Garde d'écriture : session valide + rôle administrateur. */
function requireAdmin(req, res, next) {
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ ok: false, code: "auth-required", error: "Войдите в редакцию, чтобы менять содержимое." });
    return;
  }
  if (!isAdminUser(user)) {
    res.status(403).json({ ok: false, code: "admin-required", error: "Только редакция может менять ленту и сообщения." });
    return;
  }
  req.oknoUser = user;
  next();
}

/** Garde d'écriture : session valide, quel que soit le rôle (lecteur ou rédaction). */
function requireUser(req, res, next) {
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ ok: false, code: "auth-required", error: "Войдите, чтобы комментировать." });
    return;
  }
  req.oknoUser = user;
  next();
}

function writeContent(res, file, list, payload, extra) {
  try {
    writeJsonFile(file, list);
    if (extra && extra.file) writeJsonFile(extra.file, extra.list);
  } catch (err) {
    res.status(500).json({
      ok: false,
      code: "write-failed",
      error: "Сервер не может записать data/: проверьте права (chmod 777 data/, 666 data/*.json).",
      detail: String((err && err.message) || err),
    });
    return false;
  }
  res.json(Object.assign({ ok: true, updatedAt: new Date().toISOString() }, payload || {}));
  return true;
}

const newContentId = (prefix) =>
  prefix + "_" + Date.now().toString(36) + "_" + crypto.randomBytes(3).toString("hex");

// ——— Messages de la rédaction (ce que voient les utilisateurs) ———
app.get("/api/messages", (req, res) => {
  let items = readMessages();
  // Les brouillons ne sortent que pour la rédaction.
  if (!(req.query.all === "1" && isAdminUser(sessionUser(req)))) {
    items = items.filter((m) => m.active !== false);
  }
  items = items
    .slice()
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || 0) - Date.parse(a.updatedAt || a.createdAt || 0));
  res.json({ updatedAt: new Date().toISOString(), items });
});

app.post("/api/messages", requireAdmin, (req, res) => {
  const body = req.body || {};
  const items = readMessages();
  const id = clampText(body.id, 40);
  const idx = id ? items.findIndex((m) => m.id === id) : -1;
  // un id inconnu n'est jamais une création déguisée
  if (id && idx < 0) {
    res.status(404).json({ ok: false, code: "not-found", error: "Сообщение не найдено." });
    return;
  }
  const next = sanitizeMessage(body, idx >= 0 ? items[idx] : null);
  if (!hasText(next.title)) {
    res.status(400).json({ ok: false, code: "title-required", error: "Заполните заголовок хотя бы на одном языке." });
    return;
  }
  // L'auteur est toujours un login de session, jamais une valeur du client.
  next.author = clampText(idx >= 0 ? items[idx].author : "", 40) || req.oknoUser.login;
  if (idx >= 0) {
    items[idx] = Object.assign({}, next, { id: items[idx].id, createdAt: items[idx].createdAt, updatedAt: new Date().toISOString() });
  } else {
    items.unshift(
      Object.assign({}, next, { id: newContentId("m"), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    );
  }
  writeContent(res, MESSAGES_FILE, items.slice(0, MAX_MESSAGES), { items: items.slice(0, MAX_MESSAGES) });
});

app.delete("/api/messages", requireAdmin, (req, res) => {
  const id = clampText((req.body && req.body.id) || req.query.id, 40);
  const items = readMessages();
  const next = items.filter((m) => m.id !== id);
  if (next.length === items.length) {
    res.status(404).json({ ok: false, code: "not-found", error: "Сообщение не найдено." });
    return;
  }
  // Retirer un message emporte ses commentaires : ils vivent avec lui.
  const comments = readComments().filter((c) => c.messageId !== id);
  writeContent(
    res,
    MESSAGES_FILE,
    next,
    { removed: id, items: next },
    { file: COMMENTS_FILE, list: comments }
  );
});

// ——— Commentaires des messages ———
//
// Écrire un message reste réservé à la rédaction (rôle « editor »), mais tout
// utilisateur connecté — lecteur comme éditeur — peut commenter les messages.
// Un commentaire n'est pas bilingue : son auteur écrit dans la langue qu'il
// veut, et le texte passe tel quel (jamais de HTML).
app.get("/api/comments", (req, res) => {
  const user = sessionUser(req);
  const admin = isAdminUser(user);
  // Un commentaire vit avec son message : pour qui ne voit que les messages
  // publiés, les commentaires des brouillons n'existent pas. La rédaction,
  // elle, voit tout — brouillons et commentaires compris.
  const visibleIds = new Set(
    readMessages()
      .filter((m) => admin || m.active !== false)
      .map((m) => m.id)
  );
  const only = clampText(req.query.messageId, 40);
  const items = readComments()
    .filter((c) => c && visibleIds.has(c.messageId) && (!only || c.messageId === only))
    .sort((a, b) => Date.parse(a.createdAt || 0) - Date.parse(b.createdAt || 0));
  res.json({ ok: true, updatedAt: new Date().toISOString(), items });
});

app.post("/api/comments", requireUser, (req, res) => {
  const body = req.body || {};
  const user = req.oknoUser;
  const msgId = clampText(body.messageId, 40);
  const msg = readMessages().find((m) => m.id === msgId);
  // Un lecteur ne commente que les messages publiés ; la rédaction peut aussi
  // commenter ses brouillons (ils restent invisibles hors de la rédaction).
  if (!msg || (!isAdminUser(user) && msg.active === false)) {
    res.status(404).json({ ok: false, code: "message-not-found", error: "Сообщение не найдено." });
    return;
  }
  const next = sanitizeComment(body);
  if (!next.body) {
    res.status(400).json({ ok: false, code: "comment-required", error: "Заполните текст комментария." });
    return;
  }
  const now = new Date().toISOString();
  const comment = Object.assign({}, next, {
    id: newContentId("c"),
    // L'auteur est un login de session, jamais une valeur du client.
    author: user.login,
    createdAt: now,
    updatedAt: now,
  });
  let comments = readComments();
  comments.push(comment);
  if (comments.length > MAX_COMMENTS) comments = comments.slice(-MAX_COMMENTS);
  writeContent(res, COMMENTS_FILE, comments, { item: comment });
});

app.delete("/api/comments", (req, res) => {
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ ok: false, code: "auth-required", error: "Войдите, чтобы удалять комментарии." });
    return;
  }
  const id = clampText((req.body && req.body.id) || req.query.id, 40);
  const items = readComments();
  const idx = id ? items.findIndex((c) => c.id === id) : -1;
  if (idx < 0) {
    res.status(404).json({ ok: false, code: "not-found", error: "Комментарий не найден." });
    return;
  }
  // Chacun retire son propre commentaire ; la rédaction modère l'ensemble.
  const isAuthor = items[idx].author === user.login;
  if (!isAuthor && !isAdminUser(user)) {
    res.status(403).json({ ok: false, code: "not-owner", error: "Можно удалить только свой комментарий." });
    return;
  }
  const next = items.slice();
  next.splice(idx, 1);
  writeContent(res, COMMENTS_FILE, next, { removed: id, items: next });
});

// ——— La bande (les flux préparés par la rédaction) ———
app.get("/api/dispatches", (req, res) => {
  const dispatches = readDispatches()
    .slice()
    .sort((a, b) => Date.parse(b.publishedAt || 0) - Date.parse(a.publishedAt || 0));
  res.json({ updatedAt: new Date().toISOString(), items: dispatches });
});

app.post("/api/dispatches", requireAdmin, (req, res) => {
  const body = req.body || {};
  const items = readDispatches();
  const id = clampText(body.id, 40);
  const idx = id ? items.findIndex((d) => d.id === id) : -1;
  if (id && idx < 0) {
    res.status(404).json({ ok: false, code: "not-found", error: "Депеша не найдена." });
    return;
  }
  const next = sanitizeDispatch(body, idx >= 0 ? items[idx] : null);
  if (!next.title) {
    res.status(400).json({ ok: false, code: "title-required", error: "Заполните заголовок депеши." });
    return;
  }
  if (idx >= 0) {
    items[idx] = Object.assign({}, next, { id: items[idx].id });
  } else {
    items.unshift(Object.assign({}, next, { id: newContentId("d") }));
  }
  writeContent(res, DISPATCHES_FILE, items.slice(0, MAX_DISPATCHES), { items: items.slice(0, MAX_DISPATCHES) });
});

app.delete("/api/dispatches", requireAdmin, (req, res) => {
  const id = clampText((req.body && req.body.id) || req.query.id, 40);
  const items = readDispatches();
  const next = items.filter((d) => d.id !== id);
  if (next.length === items.length) {
    res.status(404).json({ ok: false, code: "not-found", error: "Депеша не найдена." });
    return;
  }
  writeContent(res, DISPATCHES_FILE, next, { removed: id, items: next });
});

// Message d'accueil de la rédaction : écrit une seule fois, à l'installation.
function ensureContentFiles() {
  ensureDataFile();
  if (!fs.existsSync(DISPATCHES_FILE)) writeJsonFile(DISPATCHES_FILE, []);
  if (!fs.existsSync(COMMENTS_FILE)) writeJsonFile(COMMENTS_FILE, []);
  if (!fs.existsSync(MESSAGES_FILE)) {
    writeJsonFile(MESSAGES_FILE, [
      {
        id: "m_welcome",
        title: { ru: "Личный кабинет открыт", en: "Your dashboard is open" },
        body: {
          ru: "Редакция публикует здесь сообщения для читателей. Источники ленты остаются внутри редакции.",
          en: "The newsroom posts its notes for readers here. The feed sources stay inside the newsroom.",
        },
        active: true,
        author: "okno",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
  }
}

ensureDataFile();
ensureAuthFile();
ensureContentFiles();

if (require.main === module) {
  loadNews(true).catch(() => {});
  app.listen(PORT, HOST, () => {
    console.log(`Empreinte écoute sur http://${HOST}:${PORT}`);
    console.log(`DATA_DIR=${DATA_DIR} (persistent: ${DATA_DIR !== path.join(__dirname, "data")})`);
    console.log(`Visits file: ${VISITS_FILE}`);
  });
}

module.exports = {
  app,
  decodeFeedBuffer,
  charsetOf,
  fetchFeed,
  stripHtml,
  cookieValue,
  sha256,
  hashFromClient,
  decoySalt,
  AUTH_SCHEME,
  FEEDS,
};
