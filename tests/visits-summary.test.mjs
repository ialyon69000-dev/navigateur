/**
 * visits.json ne contient plus seulement le journal brut : il porte aussi une
 * synthèse (summary) et une fiche par client, recalculées à chaque écriture à
 * partir des seules données déjà envoyées par le navigateur.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okno-visits-"));
process.env.DATA_DIR = dataDir;

const { app } = await import("../server.js");
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const visitsFile = () => path.join(dataDir, "visits.json");
const readFile = () => JSON.parse(fs.readFileSync(visitsFile(), "utf8"));

function clientBody(extra = {}) {
  return {
    language: "fr",
    languages: ["fr", "en"],
    timezone: "Europe/Paris",
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
    screen: { width: 1920, height: 1080, colorDepth: 24, pixelRatio: 1 },
    hardwareConcurrency: 8,
    referrer: "https://ya.ru/",
    theme: { colorScheme: "dark" },
    consent: true,
    ...extra,
  };
}

// Le serveur impose un délai entre deux enregistrements d'une même IP : chaque
// appel de test utilise donc son propre X-Forwarded-For.
let ipSeq = 0;
async function record(body, ip) {
  const res = await fetch(base + "/api/visit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": ip || `203.0.113.${++ipSeq}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

// Rejoue une visite déjà enregistrée (même poste, plus tard) sans repasser par
// l'API, dont le garde-fou anti-rafale refuserait la seconde requête.
function replay(visit, minutesLater) {
  const copy = JSON.parse(JSON.stringify(visit));
  copy.id = visit.id + "_bis";
  copy.recordedAt = new Date(Date.parse(visit.recordedAt) + minutesLater * 60000).toISOString();
  return copy;
}

test("visits.json porte une synthèse et une fiche par client", async () => {
  const first = await record(clientBody());
  assert.equal(first.status, 201);
  assert.ok(first.json.summary, "la réponse renvoie la synthèse à jour");

  const file = readFile();
  assert.deepEqual(Object.keys(file), ["generatedAt", "summary", "clients", "visits"]);
  assert.equal(file.summary.totalVisits, 1);
  assert.equal(file.summary.uniqueClients, 1);
  assert.equal(file.summary.returningClients, 0);
  assert.equal(file.visits.length, 1);

  const c = file.clients[0];
  // sans cookie représenté, l'identité repose sur l'empreinte : préfixe fp_
  assert.match(c.clientId, /^fp_[0-9a-f]{16}$/);
  assert.equal(c.identity, "fingerprint");
  assert.equal(c.visits, 1);
  assert.equal(c.returning, false);
  assert.equal(c.device.type, "desktop");
  assert.equal(c.device.os, "Windows 10/11");
  assert.equal(c.device.browser, "Chrome");
  assert.equal(c.device.screen, "1920×1080");
  assert.equal(c.preferences.language, "fr");
  assert.equal(c.preferences.colorScheme, "dark");
  assert.deepEqual(c.referrers, [{ value: "https://ya.ru/", count: 1 }]);
  assert.equal(c.visitIds.length, 1);
});

test("deux visites du même poste ne font qu'un client (visiteur récurrent)", async () => {
  // même empreinte (IP, écran, système, langue, fuseau) → même clientId
  fs.writeFileSync(visitsFile(), "[]\n");
  const a = await record(clientBody());
  assert.equal(a.status, 201);
  const later = replay(a.json.visit, 90);
  later.referrer = "https://lenta.ru/";
  fs.writeFileSync(visitsFile(), JSON.stringify([later, a.json.visit], null, 2));

  const file = JSON.parse(JSON.stringify(await (await fetch(base + "/api/visits")).json()));
  assert.equal(file.summary.totalVisits, 2);
  assert.equal(file.summary.uniqueClients, 1);
  assert.equal(file.summary.returningClients, 1);
  assert.equal(file.summary.returningRate, 1);
  assert.equal(file.summary.visitsPerClient, 2);
  const c = file.clients[0];
  assert.equal(c.visits, 2);
  assert.equal(c.returning, true);
  assert.equal(c.referrers.length, 2);
  fs.writeFileSync(visitsFile(), JSON.stringify(file.visits, null, 2));
});

test("un poste différent crée un second client", async () => {
  fs.writeFileSync(visitsFile(), "[]\n");
  await record(clientBody());
  await record(
    clientBody({
      language: "ru",
      timezone: "Europe/Moscow",
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/605.1",
      screen: { width: 390, height: 844, colorDepth: 24 },
      maxTouchPoints: 5,
    }),
  );
  const file = readFile();
  assert.equal(file.summary.uniqueClients, 2);
  assert.equal(file.summary.returningClients, 0);
  const types = file.clients.map((c) => c.device.type).sort();
  assert.deepEqual(types, ["desktop", "mobile"]);
  assert.ok(file.summary.topDevices.some((d) => d.value === "mobile"));
  assert.ok(file.summary.topLanguages.some((l) => l.value === "ru"));
});

test("l'API expose la synthèse, seule ou avec le journal", async () => {
  const full = await (await fetch(base + "/api/visits")).json();
  assert.equal(typeof full.summary, "object");
  assert.ok(Array.isArray(full.clients));
  assert.ok(Array.isArray(full.visits));
  assert.equal(full.total, full.visits.length);

  const only = await (await fetch(base + "/api/visits/summary")).json();
  assert.equal(only.visits, undefined, "la synthèse seule ne transporte pas le journal");
  assert.equal(only.summary.uniqueClients, full.summary.uniqueClients);
});

test("un ancien visits.json (simple tableau) reste lisible", async () => {
  const previous = readFile().visits;
  assert.ok(previous.length >= 1);
  fs.writeFileSync(visitsFile(), JSON.stringify(previous, null, 2));
  const res = await (await fetch(base + "/api/visits")).json();
  assert.equal(res.total, previous.length);
  assert.equal(res.summary.totalVisits, previous.length);
  assert.ok(res.clients.length >= 1);
});

test("vider le journal remet la synthèse à zéro", async () => {
  await fetch(base + "/api/visits", { method: "DELETE" });
  const file = readFile();
  assert.equal(file.summary.totalVisits, 0);
  assert.equal(file.summary.uniqueClients, 0);
  assert.equal(file.summary.returningRate, 0);
  assert.deepEqual(file.clients, []);
  assert.deepEqual(file.visits, []);
});
