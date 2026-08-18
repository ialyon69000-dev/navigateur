"use strict";

const iconv = require("iconv-lite");

function charsetOf(contentType, xmlHead, feedId) {
  const fromHeader = String(contentType || "").match(/charset=([^\s;]+)/i);
  const fromXml = String(xmlHead || "").match(/encoding=["']([^"']+)["']/i);
  let cs = ((fromHeader && fromHeader[1]) || (fromXml && fromXml[1]) || "utf-8")
    .trim()
    .replace(/["']/g, "")
    .toLowerCase();
  if (
    feedId === "gazeta" ||
    cs === "cp1251" ||
    cs === "windows-1251" ||
    cs === "win-1251" ||
    cs === "windows1251"
  ) {
    return "win1251";
  }
  if (cs === "utf8") return "utf-8";
  return cs;
}

function looksBrokenCyrillic(s) {
  const sample = String(s || "").slice(0, 4000);
  const cyr = (sample.match(/[А-Яа-яЁё]/g) || []).length;
  const repl = (sample.match(/\uFFFD/g) || []).length;
  const qm = (sample.match(/\?/g) || []).length;
  return cyr < 10 || repl > 4 || (cyr < 8 && qm > 20);
}

function decodeRssBuffer(buf, contentType, feedId) {
  const headAscii = Buffer.from(buf).subarray(0, 280).toString("latin1");
  let cs = charsetOf(contentType, headAscii, feedId);
  let xml = iconv.decode(buf, cs);
  if (looksBrokenCyrillic(xml)) {
    xml = iconv.decode(buf, cs === "win1251" ? "utf-8" : "win1251");
  }
  if (feedId === "gazeta" && looksBrokenCyrillic(xml)) {
    xml = iconv.decode(buf, "win1251");
  }
  xml = xml.replace(/^\uFEFF/, "");
  if (/encoding=["'][^"']+["']/i.test(xml.slice(0, 180))) {
    xml = xml.replace(/encoding=["'][^"']+["']/i, 'encoding="UTF-8"');
  } else if (!/<\?xml/i.test(xml.slice(0, 80))) {
    xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  }
  return xml;
}

function isGarbledText(s) {
  const t = String(s || "");
  const cyr = (t.match(/[А-Яа-яЁё]/g) || []).length;
  const bad = (t.match(/[\uFFFD?]/g) || []).length;
  return cyr < 2 && bad >= 3;
}

module.exports = { decodeRssBuffer, isGarbledText, looksBrokenCyrillic };
