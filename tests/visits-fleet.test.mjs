/**
 * Cas limite : une FLOTTE de terminaux IDENTIQUES derrière des IP tournantes.
 *
 * C'est le scénario qui met en défaut toute empreinte passive :
 *  - le matériel est le même partout → l'empreinte ne distingue pas les postes ;
 *  - l'IP change à chaque requête    → elle ne suit pas un poste.
 *
 * Seul un identifiant déposé par nous (cookie propriétaire) tranche. Ces tests
 * vérifient les deux régimes, et surtout que le fichier reste HONNÊTE sur la
 * fiabilité du comptage (champ `identity`).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okno-fleet-"));
process.env.DATA_DIR = dataDir;

const { app } = await import("../server.js");
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;
after(() => server.close());

const visitsFile = () => path.join(dataDir, "visits.json");
const summaryFile = () => path.join(dataDir, "visits_summary.json");
// la synthèse vit dans son propre fichier ; on y joint le journal pour les
// assertions qui portent sur les deux
const readFile = () => ({
  ...JSON.parse(fs.readFileSync(summaryFile(), "utf8")),
  visits: JSON.parse(fs.readFileSync(visitsFile(), "utf8")),
});
const reset = () => fs.writeFileSync(visitsFile(), "[]\n");

// Terminaux rigoureusement identiques : même modèle, même écran, même GPU.
const PHONE = {
  language: "ru",
  languages: ["ru"],
  timezone: "Europe/Moscow",
  userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A546B) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
  screen: { width: 412, height: 915, colorDepth: 24, pixelRatio: 2.625 },
  hardwareConcurrency: 8,
  deviceMemory: 6,
  maxTouchPoints: 5,
  gpu: { vendor: "ARM", renderer: "Mali-G68 MC4" },
  consent: true,
};

let ipCounter = 0;
/** Une requête depuis une IP jamais vue, avec (ou sans) le pot de cookies du terminal. */
async function visitFrom(jar) {
  ipCounter++;
  const headers = {
    "Content-Type": "application/json",
    "X-Forwarded-For": `85.10.${(ipCounter >> 8) & 255}.${ipCounter & 255}`,
  };
  if (jar && jar.cookie) headers.Cookie = jar.cookie;
  const res = await fetch(base + "/api/visit", {
    method: "POST",
    headers,
    body: JSON.stringify(PHONE),
  });
  const setCookie = res.headers.get("set-cookie");
  // un terminal qui accepte les cookies mémorise celui qu'on lui envoie
  if (jar && setCookie) jar.cookie = setCookie.split(";")[0];
  await new Promise((r) => setTimeout(r, 5)); // évite la fusion anti-rafale
  return res;
}

test("flotte de 5 téléphones identiques, IP tournante : 5 clients distincts", async () => {
  reset();
  const phones = [1, 2, 3, 4, 5].map(() => ({ cookie: null }));
  for (const jar of phones) {
    for (let i = 0; i < 3; i++) await visitFrom(jar);
  }

  const file = readFile();
  assert.equal(file.summary.totalVisits, 15);
  assert.equal(file.summary.uniqueClients, 5, "un client par appareil, pas un par IP");
  assert.equal(file.summary.returningClients, 5, "chaque appareil est vu comme récurrent");
  assert.equal(file.summary.identifiedByCookie, 5);
  assert.equal(file.summary.identifiedByFingerprint, 0);

  for (const c of file.clients) {
    assert.equal(c.visits, 3);
    assert.equal(c.identity, "device");
    assert.match(c.clientId, /^c_[0-9a-f]{32}$/);
    assert.equal(c.distinctIps, 3, "l'appareil a bien été vu depuis 3 IP différentes");
    assert.equal(c.rotatingIp, true);
  }
  const ids = new Set(file.clients.map((c) => c.clientId));
  assert.equal(ids.size, 5, "aucune collision entre appareils identiques");
});

test("l'IP n'entre pas dans l'identité : un seul appareil qui change d'IP reste un client", async () => {
  reset();
  const jar = { cookie: null };
  for (let i = 0; i < 6; i++) await visitFrom(jar);

  const file = readFile();
  assert.equal(file.summary.totalVisits, 6);
  assert.equal(file.summary.uniqueClients, 1, "6 IP différentes, mais un seul appareil");
  assert.equal(file.clients[0].distinctIps, 6);
  assert.equal(file.clients[0].rotatingIp, true);
  assert.equal(file.summary.clientsWithRotatingIp, 1);
});

test("cookies refusés : le comptage est approximatif ET signalé comme tel", async () => {
  reset();
  // aucun pot de cookies : le terminal ne renvoie jamais ce qu'on lui pose
  for (let i = 0; i < 15; i++) await visitFrom(null);

  const file = readFile();
  assert.equal(file.summary.totalVisits, 15);
  // Des appareils identiques sans cookie sont indiscernables : ils fusionnent.
  // Le point capital est que le fichier ne prétend PAS le contraire.
  assert.equal(file.summary.identifiedByCookie, 0, "aucun cookie confirmé");
  assert.equal(file.summary.identifiedByFingerprint, file.summary.uniqueClients);
  for (const c of file.clients) {
    assert.equal(c.identity, "fingerprint");
    assert.match(c.clientId, /^fp_/);
    assert.match(c.identityNote, /confondus/);
  }
});

test("un cookie jamais représenté ne crée pas de client fantôme à chaque visite", async () => {
  reset();
  for (let i = 0; i < 8; i++) await visitFrom(null);
  const file = readFile();
  // 8 cookies ont été émis, aucun n'est revenu : ils ne doivent pas compter.
  assert.ok(file.summary.uniqueClients < 8, `attendu < 8 clients, obtenu ${file.summary.uniqueClients}`);
  assert.equal(file.summary.identifiedByCookie, 0);
  assert.ok(
    file.visits.every((v) => v.deviceConfirmed === false),
    "aucune visite ne prétend disposer d'un cookie confirmé",
  );
});

test("flotte mixte : les appareils avec cookie sont comptés exactement", async () => {
  reset();
  const withCookie = [{ cookie: null }, { cookie: null }, { cookie: null }];
  for (const jar of withCookie) {
    for (let i = 0; i < 2; i++) await visitFrom(jar);
  }
  for (let i = 0; i < 4; i++) await visitFrom(null); // terminaux sans cookie

  const file = readFile();
  assert.equal(file.summary.totalVisits, 10);
  assert.equal(file.summary.identifiedByCookie, 3, "les 3 appareils à cookie sont exacts");
  assert.ok(file.summary.identifiedByFingerprint >= 1, "le reste bascule en approximatif");
  const exact = file.clients.filter((c) => c.identity === "device");
  assert.equal(exact.length, 3);
  for (const c of exact) assert.equal(c.visits, 2);
});
