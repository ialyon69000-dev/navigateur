"use strict";

const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");
const { decodeRssBuffer, isGarbledText } = require("../lib/rss-decode");

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
  timeout: 15000,
  headers: {
    "User-Agent": "OKNO RSS cache bot/1.0",
    Accept: "application/rss+xml, application/xml, text/xml, */*",
  },
  customFields: {
    item: [
      ["media:content", "mediaContent"],
      ["media:thumbnail", "mediaThumb"],
    ],
  },
});

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

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  const res = await fetch(feed.url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": "OKNO RSS cache bot/1.0",
      Accept: "application/rss+xml, application/xml, text/xml, */*",
    },
  });
  clearTimeout(timer);
  if (!res.ok) throw new Error("http " + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  const xml = decodeRssBuffer(buf, res.headers.get("content-type"), feed.id);
  const parsed = await parser.parseString(xml);
  return (parsed.items || []).slice(0, 24)
    .map((item) => ({
      id: item.guid || item.link || `${feed.id}-${item.title}`,
      title: stripHtml(item.title) || "Sans titre",
      link: item.link || parsed.link || "#",
      source: feed.name,
      sourceId: feed.id,
      color: feed.color,
      category: stripHtml(item.categories && item.categories[0]) || stripHtml(item.category) || null,
      publishedAt: item.isoDate || item.pubDate || null,
      summary: stripHtml(item.contentSnippet || item.summary || item.description).slice(0, 280),
      image: guessImage(item, feed.id, pickImage(item)),
    }))
    .filter((item) => !isGarbledText(item.title));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload) + "\n");
}

(async () => {
  const settled = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed)));
  const items = [];
  const errors = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") items.push(...result.value);
    else errors.push({ source: FEEDS[index].name, error: String(result.reason && result.reason.message || result.reason) });
  });
  items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const seen = new Set();
  const unique = items.filter((item) => {
    const key = (item.title || "").toLowerCase().slice(0, 100);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 120);
  if (!unique.length) throw new Error("No RSS item was retrieved; existing cache is preserved.");

  const payload = { at: Date.now(), items: unique, errors };
  const embedded = { at: payload.at, items: unique.slice(0, 60), errors: [] };
  const root = path.join(__dirname, "..");
  writeJson(path.join(root, "infinityfree", "htdocs", "data", "news_cache.json"), payload);
  writeJson(path.join(root, "infinityfree", "htdocs", "data", "news_embedded.json"), embedded);
  writeJson(path.join(root, "data", "news_cache.json"), payload);
  console.log(`Wrote ${unique.length} articles (${errors.length} source errors).`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
