/**
 * Contrat des DEUX fichiers :
 *
 *   data/visits.json          → le journal brut, intégral. Un tableau, une
 *                               entrée par visite, aucune donnée agrégée.
 *   data/visits_summary.json  → la synthèse, dérivée du journal. Aucune copie
 *                               des visites : elle référence sa source.
 *
 * Règle : la synthèse est TOUJOURS régénérée à partir du journal qu'on vient
 * d'écrire, donc les deux fichiers ne peuvent pas diverger.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okno-files-"));
process.env.DATA_DIR = dataDir;

const { app } = await import("../server.js");
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const JOURNAL = path.join(dataDir, "visits.json");
const SUMMARY = path.join(dataDir, "visits_summary.json");
const journal = () => JSON.parse(fs.readFileSync(JOURNAL, "utf8"));
const summary = () => JSON.parse(fs.readFileSync(SUMMARY, "utf8"));

let seq = 0;
async function visit(jar) {
  seq++;
  const headers = { "Content-Type": "application/json", "X-Forwarded-For": `91.20.3.${seq}` };
  if (jar && jar.cookie) headers.Cookie = jar.cookie;
  const res = await fetch(base + "/api/visit", {
    method: "POST",
    headers,
    body: JSON.stringify({
      language: "ru",
      timezone: "Europe/Moscow",
      userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546B) Chrome/120 Mobile",
      screen: { width: 412, height: 915, colorDepth: 24 },
      referrer: "https://ya.ru/",
      consent: true,
    }),
  });
  const sc = res.headers.get("set-cookie");
  if (jar && sc) jar.cookie = sc.split(";")[0];
  await new Promise((r) => setTimeout(r, 6));
  return res;
}

test("les deux fichiers existent et ont chacun leur rôle", async () => {
  const jar = { cookie: null };
  await visit(jar);
  await visit(jar);

  assert.ok(fs.existsSync(JOURNAL), "data/visits.json");
  assert.ok(fs.existsSync(SUMMARY), "data/visits_summary.json");

  // journal : un tableau pur, chaque visite intégrale
  const j = journal();
  assert.ok(Array.isArray(j), "le journal est un tableau");
  assert.equal(j.length, 2);
  for (const v of j) {
    assert.match(v.id, /^v_/);
    assert.ok(v.recordedAt);
    assert.ok("ip" in v && "geoIp" in v && "screen" in v && "userAgent" in v);
  }

  // synthèse : agrégats seulement, pas de recopie du journal
  const s = summary();
  assert.deepEqual(Object.keys(s), ["generatedAt", "source", "summary", "clients"]);
  assert.equal(s.source, "data/visits.json");
  assert.equal(s.visits, undefined, "la synthèse ne duplique pas le journal");
  assert.equal(s.summary.totalVisits, 2);
  assert.equal(s.summary.uniqueClients, 1);
});

test("le journal trace TOUT : une ligne par visite, rien n'est agrégé", async () => {
  fs.writeFileSync(JOURNAL, "[]\n");
  const jar = { cookie: null };
  const n = 7;
  for (let i = 0; i < n; i++) await visit(jar);

  const j = journal();
  assert.equal(j.length, n, "une entrée par visite, sans déduplication");
  const ids = new Set(j.map((v) => v.id));
  assert.equal(ids.size, n, "chaque visite garde un identifiant distinct");
  const ips = new Set(j.map((v) => v.ip));
  assert.equal(ips.size, n, "chaque IP traversée est conservée telle quelle");

  // la synthèse, elle, regroupe : 1 client pour n visites
  assert.equal(summary().summary.totalVisits, n);
  assert.equal(summary().summary.uniqueClients, 1);
});

test("les deux fichiers restent cohérents après chaque écriture", async () => {
  fs.writeFileSync(JOURNAL, "[]\n");
  for (let i = 0; i < 4; i++) {
    await visit(null);
    assert.equal(
      summary().summary.totalVisits,
      journal().length,
      "la synthèse suit le journal à chaque écriture",
    );
  }
});

test("synthèse absente ou périmée : elle est reconstruite depuis le journal", async () => {
  const jar = { cookie: null };
  fs.writeFileSync(JOURNAL, "[]\n");
  await visit(jar);
  await visit(jar);
  const attendu = journal().length;

  // fichier supprimé
  fs.unlinkSync(SUMMARY);
  let res = await (await fetch(base + "/api/visits/summary")).json();
  assert.equal(res.summary.totalVisits, attendu);
  assert.ok(fs.existsSync(SUMMARY), "la synthèse est réécrite sur disque");

  // fichier périmé (journal modifié à la main, hors de l'application)
  const j = journal();
  j.pop();
  fs.writeFileSync(JOURNAL, JSON.stringify(j, null, 2));
  res = await (await fetch(base + "/api/visits/summary")).json();
  assert.equal(res.summary.totalVisits, j.length, "la synthèse se recale sur le journal");
  assert.equal(summary().summary.totalVisits, j.length);
});

test("les deux fichiers se téléchargent séparément", async () => {
  const jRes = await fetch(base + "/api/visits.json");
  assert.match(jRes.headers.get("content-disposition"), /visits\.json/);
  assert.ok(Array.isArray(await jRes.json()), "le téléchargement du journal est un tableau");

  const sRes = await fetch(base + "/api/visits_summary.json");
  assert.match(sRes.headers.get("content-disposition"), /visits_summary\.json/);
  const s = await sRes.json();
  assert.equal(s.source, "data/visits.json");
  assert.ok(s.summary && s.clients, "le téléchargement de la synthèse porte summary + clients");
  assert.equal(s.visits, undefined);
});

test("purge : les deux fichiers repartent de zéro", async () => {
  await visit(null);
  await fetch(base + "/api/visits", { method: "DELETE" });
  assert.deepEqual(journal(), [], "journal vidé");
  const s = summary();
  assert.equal(s.summary.totalVisits, 0);
  assert.deepEqual(s.clients, []);
});

test("l'ancien format fusionné est encore lu, puis re-séparé à l'écriture", async () => {
  // visits.json tel qu'il était avant la séparation : { summary, clients, visits }
  const ancien = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: { totalVisits: 1 },
    clients: [],
    visits: [
      {
        id: "v_ancien",
        recordedAt: "2026-01-01T00:00:00.000Z",
        ip: "91.20.9.9",
        language: "ru",
        screen: { width: 412, height: 915 },
        userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile",
      },
    ],
  };
  fs.writeFileSync(JOURNAL, JSON.stringify(ancien, null, 2));

  const res = await (await fetch(base + "/api/visits")).json();
  assert.equal(res.total, 1, "les visites de l'ancien format sont retrouvées");
  assert.equal(res.visits[0].id, "v_ancien");

  // une nouvelle écriture remet le journal au format tableau
  await visit(null);
  assert.ok(Array.isArray(journal()), "visits.json est redevenu un tableau");
  assert.equal(journal().length, 2, "l'ancienne visite est préservée");
  assert.ok(journal().some((v) => v.id === "v_ancien"));
});
