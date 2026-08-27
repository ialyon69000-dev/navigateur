"use strict";
const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");
const iconv = require("iconv-lite");

const feeds = [
  ["tass", "TASS", "https://tass.ru/rss/v2.xml", "#c8102e"],
  ["ria", "RIA Novosti", "https://ria.ru/export/rss2/index.xml", "#e30613"],
  ["lenta", "Lenta.ru", "https://lenta.ru/rss", "#ee1c25"],
  ["kommersant", "Коммерсантъ", "https://www.kommersant.ru/RSS/main.xml", "#111111"],
  ["izvestia", "Известия", "https://iz.ru/xml/rss/all.xml", "#1a3c6e"],
  ["mk", "МК", "https://www.mk.ru/rss/index.xml", "#b71c1c"],
  ["gazeta", "Газета.Ru", "https://www.gazeta.ru/export/rss/first.xml", "#2c3e50"],
];
const parser = new Parser({ timeout: 15000, headers: { "User-Agent": "OKNO RSS cache bot/1.0", Accept: "application/rss+xml, application/xml, text/xml, */*" } });
const clean = (text) => String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

// ——— Décodage robuste (mêmes règles que server.js) ———
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

function isValidUtf8(buf) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function score(text) {
  const sample = String(text || "").slice(0, 6000);
  const cyr = (sample.match(/[А-Яа-яЁё]/g) || []).length;
  const repl = (sample.match(/\uFFFD/g) || []).length;
  return cyr - 5 * repl;
}

function decodeFeed(buf, contentType) {
  const head = buf.subarray(0, 220).toString("latin1");
  const declared = charsetOf(contentType, head);
  if (isValidUtf8(buf)) {
    const text = iconv.decode(buf, "utf-8").replace(/^\uFEFF/, "");
    if (score(text) >= 10 || declared === "utf-8" || !declared) return text;
  }
  const candidates = [declared, "win1251", "koi8-r", "utf-8"].filter(Boolean);
  let best = null;
  for (const cs of [...new Set(candidates)]) {
    let text;
    try {
      text = iconv.decode(buf, cs);
    } catch {
      continue;
    }
    const s = score(text);
    if (!best || s > best.score) best = { text, score: s };
  }
  return (best ? best.text : iconv.decode(buf, "utf-8")).replace(/^\uFEFF/, "");
}

async function fetchXml(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "OKNO RSS cache bot/1.0",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error("http " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  return decodeFeed(buf, res.headers.get("content-type"));
}

(async () => {
  const settled = await Promise.allSettled(feeds.map(async ([sourceId, source, url, color]) => {
    const xml = await fetchXml(url);
    const feed = await parser.parseString(xml);
    return (feed.items || []).slice(0, 24).map((item) => ({
      id: item.guid || item.id || `${sourceId}-${item.link || item.title}`,
      title: clean(item.title) || "Sans titre",
      link: item.link || "#", source, sourceId, color,
      category: clean(item.categories && item.categories[0]),
      publishedAt: item.isoDate || item.pubDate || null,
      summary: clean(item.contentSnippet || item.content || item.title).slice(0, 280),
      image: item.enclosure && /image/i.test(item.enclosure.type || "") ? item.enclosure.url : null,
    }));
  }));
  const items = [], errors = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else errors.push({ source: feeds[index][1], error: String(result.reason && result.reason.message || result.reason) });
  });
  items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const seen = new Set();
  const unique = items.filter((item) => {
    const key = item.title.toLowerCase().slice(0, 100);
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 120);
  if (!unique.length) throw new Error("No RSS item was retrieved; existing cache is preserved.");
  const output = path.join(__dirname, "..", "infinityfree", "htdocs", "data", "news_cache.json");
  fs.writeFileSync(output, JSON.stringify({ at: Date.now(), items: unique, errors }) + "\n", "utf8");
  console.log(`Wrote ${unique.length} articles (${errors.length} source errors).`);
})().catch((error) => { console.error(error); process.exit(1); });
