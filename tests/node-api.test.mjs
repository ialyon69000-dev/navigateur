/**
 * Même scénario que tests/php-api.test.mjs, mais contre la version Node
 * (server.js) : les deux implémentations doivent accepter exactement les mêmes
 * requêtes, calculées par le vrai code client.
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadAuth } from "./helpers/load-auth.mjs";

const nodeSha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okno-node-"));
fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify([
  {
    id: "u_legacy",
    login: "ancien",
    hash: nodeSha("vieuxmotdepasse" + "sel-ancien"),
    salt: "sel-ancien",
    createdAt: "2026-01-01T00:00:00Z",
    role: "reader",
  },
], null, 2));
process.env.DATA_DIR = dataDir;

const { app, hashFromClient, AUTH_SCHEME } = await import("../server.js");
const client = loadAuth({ ids: [] }).auth;

const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function call(url, opts = {}) {
  const res = await fetch(base + url, opts);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (e) {
    json = null;
  }
  return { status: res.status, json, text, headers: res.headers };
}

function post(url, body) {
  return call(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("version Node : même protocole que la version PHP", async () => {
  assert.equal(AUTH_SCHEME, 2);
  assert.equal(hashFromClient(nodeSha("abc" + "sel"), "sel"), nodeSha(nodeSha("abc" + "sel") + "sel"));

  // mot de passe en clair refusé
  const cleartext = await post("/api/auth/login", { login: "ancien", password: "vieuxmotdepasse" });
  assert.equal(cleartext.status, 400);
  assert.equal(cleartext.json.reason, "cleartext-password");

  // challenge : sel réel / sel de substitution
  const chal = await call("/api/auth/challenge?login=ancien");
  assert.equal(chal.json.salt, "sel-ancien");
  const chalA = await call("/api/auth/challenge?login=personne");
  const chalB = await call("/api/auth/challenge?login=personne");
  assert.match(chalA.json.salt, /^[0-9a-f]{16}$/);
  assert.equal(chalA.json.salt, chalB.json.salt);

  // migration d'un compte de l'ancien schéma, sans mot de passe en clair
  const legacyHash = await client.hashPassword("vieuxmotdepasse", "sel-ancien");
  assert.equal(legacyHash, nodeSha("vieuxmotdepasse" + "sel-ancien"));
  const migrated = await post("/api/auth/login", { login: "ancien", hash: legacyHash });
  assert.equal(migrated.status, 200, migrated.text);
  assert.equal(migrated.json.migrated, true);
  const cookie = (migrated.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^okno-session=okno-/);

  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, "users.json"), "utf8"))[0];
  assert.equal(stored.scheme, 2);
  assert.equal(stored.hash, nodeSha(legacyHash + "sel-ancien"));

  // session valide
  const me = await call("/api/auth/me", { headers: { cookie } });
  assert.equal(me.json.ok, true);
  assert.equal(me.json.user.login, "ancien");

  // inscription
  const salt = client.randomSalt(8);
  const hash = await client.hashPassword("motdepasse", salt);
  const reg = await post("/api/auth/register", { login: "testeur", salt, hash });
  assert.equal(reg.status, 201, reg.text);
  assert.equal(reg.json.user.role, "reader");
  const dup = await post("/api/auth/register", { login: "TESTEUR", salt, hash });
  assert.equal(dup.status, 409);

  // connexion + déconnexion
  const login = await post("/api/auth/login", { login: "testeur", hash });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.json.migrated, false);
  const cookie2 = (login.headers.get("set-cookie") || "").split(";")[0];
  const wrong = await post("/api/auth/login", { login: "testeur", hash: nodeSha("autre" + salt) });
  assert.equal(wrong.status, 401);

  const out = await call("/api/auth/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookie2 },
    body: "{}",
  });
  assert.equal(out.json.ok, true);
  const after = await call("/api/auth/me", { headers: { cookie: cookie2 } });
  assert.equal(after.json.ok, false);
});

test("version Node : compte ancien au sel exotique (espaces, cyrillique)", async () => {
  const salt = "иван petrov-m1abc";
  const users = JSON.parse(fs.readFileSync(path.join(dataDir, "users.json"), "utf8"));
  users.push({ id: "u_x", login: "иван", hash: nodeSha("motdepasse" + salt), salt, role: "reader" });
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify(users, null, 2));

  const chal = await call("/api/auth/challenge?login=" + encodeURIComponent("иван"));
  assert.equal(chal.json.salt, salt, "le sel stocké est renvoyé tel quel");
  const login = await post("/api/auth/login", { login: "иван", hash: nodeSha("motdepasse" + salt) });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.json.migrated, true);
});

test("version Node : compteur anti-brute force (5 échecs puis 429)", async () => {
  const salt = client.randomSalt(8);
  const hash = await client.hashPassword("bon-mot-de-passe", salt);
  const bad = nodeSha("mauvais-mot-de-passe" + salt);
  const reg = await post("/api/auth/register", { login: "cible-brute", salt, hash });
  assert.equal(reg.status, 201, reg.text);

  for (let i = 0; i < 5; i++) {
    const r = await post("/api/auth/login", { login: "cible-brute", hash: bad });
    assert.equal(r.status, 401, "essai " + (i + 1) + " : " + r.text);
  }

  const locked = await post("/api/auth/login", { login: "cible-brute", hash: bad });
  assert.equal(locked.status, 429, locked.text);
  assert.equal(locked.json.reason, "too-many-attempts");
  assert.match(locked.json.error, /Слишком много попыток/);
  assert.ok(locked.headers.get("retry-after"), "Retry-After est posé");

  const evenGood = await post("/api/auth/login", { login: "cible-brute", hash });
  assert.equal(evenGood.status, 429, evenGood.text);

  const otherSalt = client.randomSalt(8);
  const otherHash = await client.hashPassword("autre-secret", otherSalt);
  const otherReg = await post("/api/auth/register", { login: "voisin-brute", salt: otherSalt, hash: otherHash });
  assert.equal(otherReg.status, 201, otherReg.text);
  const otherLogin = await post("/api/auth/login", { login: "voisin-brute", hash: otherHash });
  assert.equal(otherLogin.status, 200, otherLogin.text);
});

after(() => {
  server.closeAllConnections && server.closeAllConnections();
  server.close();
});
