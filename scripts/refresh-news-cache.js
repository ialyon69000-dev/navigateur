"use strict";
const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");

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

(async () => {
  const settled = await Promise.allSettled(feeds.map(async ([sourceId, source, url, color]) => {
    const feed = await parser.parseURL(url);
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
  fs.writeFileSync(output, JSON.stringify({ at: Date.now(), items: unique, errors }) + "\n");
  console.log(`Wrote ${unique.length} articles (${errors.length} source errors).`);
})().catch((error) => { console.error(error); process.exit(1); });
