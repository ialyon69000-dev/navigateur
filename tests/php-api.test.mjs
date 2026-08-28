/**
 * Test de bout en bout de l'API PHP (infinityfree/htdocs/api/auth/*).
 *
 * Les hashes envoyés sont calculés par le VRAI code client (public/auth/auth.js) :
 * on vérifie donc la parité JavaScript ↔ PHP, pas une réimplémentation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createPhpRunner } from "./helpers/php-runner.mjs";
import { loadAuth } from "./helpers/load-auth.mjs";

const nodeSha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const clientHash = (password, salt) => nodeSha(password + salt); // == auth.js hashPassword

const runner = await createPhpRunner();
const client = loadAuth({ ids: [] }).auth;

if (!runner.request) {
  test("API PHP — ignoré (ni binaire php ni @php-wasm/node disponible)", () => {
    console.log("Installez PHP (apt install php-cli) ou `npm i -D @php-wasm/node @php-wasm/node-8-3 @php-wasm/universal`.");
  });
} else {
  test(`API PHP exécutée via ${runner.mode}`, async () => {
    // ——— health : le dossier data/ doit être inscriptible ———
    const health = await runner.request("api/health.php");
    assert.equal(health.status, 200, JSON.stringify(health));
    const healthBody = JSON.parse(health.body);
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.data.dir, "writable");
    assert.equal(healthBody.data.accounts, 1, "le compte seed « okno » est présent");

    // ——— challenge : sel du compte seed ———
    const chalSeed = await runner.request("api/auth/challenge.php", { query: { login: "okno" } });
    assert.equal(chalSeed.status, 200);
    assert.equal(JSON.parse(chalSeed.body).salt, "okno-2026");

    // ——— challenge : login inconnu → sel de substitution, pas d'énumération ———
    const chalUnknown = await runner.request("api/auth/challenge.php", { query: { login: "inexistant" } });
    assert.equal(chalUnknown.status, 200);
    const unknownBody = JSON.parse(chalUnknown.body);
    assert.equal(unknownBody.ok, true);
    assert.match(unknownBody.salt, /^[0-9a-f]{16}$/);
    const chalUnknown2 = await runner.request("api/auth/challenge.php", { query: { login: "inexistant" } });
    assert.equal(JSON.parse(chalUnknown2.body).salt, unknownBody.salt, "sel déterministe");

    // ——— le mot de passe en clair est refusé partout ———
    const cleartext = await runner.request("api/auth/login.php", {
      method: "POST",
      body: { login: "okno", password: "secret123" },
    });
    assert.equal(cleartext.status, 400);
    assert.equal(JSON.parse(cleartext.body).reason, "cleartext-password");

    // ——— inscription ———
    const salt = client.randomSalt(8);
    const hash = await client.hashPassword("motdepasse", salt);
    assert.equal(hash, clientHash("motdepasse", salt));
    const reg = await runner.request("api/auth/register.php", {
      method: "POST",
      body: { login: "testeur", salt, hash },
    });
    assert.equal(reg.status, 201, reg.body);
    assert.equal(JSON.parse(reg.body).user.login, "testeur");
    assert.equal(JSON.parse(reg.body).user.role, "reader");

    const users = JSON.parse(await runner.read("data/users.json"));
    const saved = users.find((u) => u.login === "testeur");
    assert.equal(saved.scheme, 2);
    assert.equal(saved.salt, salt);
    assert.equal(saved.hash, nodeSha(hash + salt), "H2 = sha256(H1 + sel)");
    assert.ok(!JSON.stringify(saved).includes("motdepasse"), "aucune trace du mot de passe");

    // ——— login déjà pris ———
    const dup = await runner.request("api/auth/register.php", {
      method: "POST",
      body: { login: "TESTEUR", salt, hash },
    });
    assert.equal(dup.status, 409);

    // ——— challenge renvoie le sel du compte créé ———
    const chal = await runner.request("api/auth/challenge.php", { query: { login: "testeur" } });
    assert.equal(JSON.parse(chal.body).salt, salt);

    // ——— connexion ———
    const login = await runner.request("api/auth/login.php", {
      method: "POST",
      body: { login: "testeur", hash },
    });
    assert.equal(login.status, 200, login.body);
    assert.equal(JSON.parse(login.body).ok, true);
    const sid = runner.cookieOf(login, "okno-session");
    assert.ok(sid && sid.startsWith("okno-"), "cookie de session posé");
    assert.match(login.headers.join("\n"), /HttpOnly/);

    // ——— session valide ———
    const me = await runner.request("api/auth/me.php", { cookie: "okno-session=" + sid });
    assert.equal(me.status, 200);
    assert.equal(JSON.parse(me.body).ok, true);
    assert.equal(JSON.parse(me.body).user.login, "testeur");

    // ——— mauvais hash ———
    const bad = await runner.request("api/auth/login.php", {
      method: "POST",
      body: { login: "testeur", hash: clientHash("mauvais-mot-de-passe", salt) },
    });
    assert.equal(bad.status, 401);

    // ——— sans cookie ———
    const anon = await runner.request("api/auth/me.php");
    assert.equal(JSON.parse(anon.body).ok, false);

    // ——— déconnexion ———
    const out = await runner.request("api/auth/logout.php", { method: "POST", cookie: "okno-session=" + sid });
    assert.equal(out.status, 200);
    const after = await runner.request("api/auth/me.php", { cookie: "okno-session=" + sid });
    assert.equal(JSON.parse(after.body).ok, false, "la session est bien supprimée");

    // ——— migration transparente d'un compte de l'ancien schéma (H1 stocké) ———
    const legacySalt = "sel-ancien";
    const legacyHash = clientHash("vieuxmotdepasse", legacySalt);
    runner.write(
      "data/users.json",
      JSON.stringify(
        [
          {
            id: "u_legacy",
            login: "ancien",
            hash: legacyHash,
            salt: legacySalt,
            createdAt: "2026-01-01T00:00:00Z",
            role: "reader",
          },
        ],
        null,
        2,
      ),
    );
    const chalLegacy = await runner.request("api/auth/challenge.php", { query: { login: "ancien" } });
    assert.equal(JSON.parse(chalLegacy.body).salt, legacySalt);
    const legacyLogin = await runner.request("api/auth/login.php", {
      method: "POST",
      body: { login: "ancien", hash: legacyHash },
    });
    assert.equal(legacyLogin.status, 200, legacyLogin.body);
    assert.equal(JSON.parse(legacyLogin.body).migrated, true);
    const migrated = JSON.parse(await runner.read("data/users.json"))[0];
    assert.equal(migrated.scheme, 2);
    assert.equal(migrated.hash, nodeSha(legacyHash + legacySalt), "le compte est monté au schéma 2");
    const legacyLogin2 = await runner.request("api/auth/login.php", {
      method: "POST",
      body: { login: "ancien", hash: legacyHash },
    });
    assert.equal(legacyLogin2.status, 200);
    assert.equal(JSON.parse(legacyLogin2.body).migrated, false, "plus besoin de migrer");
  });

  test("data/ non inscriptible : erreur explicite au lieu d'un faux succès", async (t) => {
    const blocked = await runner.blockDataDir();
    if (!blocked) {
      t.skip("l'environnement ignore la restriction (exécution en root)");
      return;
    }
    try {
      const health = await runner.request("api/health.php");
      assert.equal(JSON.parse(health.body).data.dir, "readonly");
      assert.match(JSON.parse(health.body).data.hint, /chmod 777/);

      const salt = client.randomSalt(8);
      const hash = await client.hashPassword("motdepasse", salt);
      const reg = await runner.request("api/auth/register.php", {
        method: "POST",
        body: { login: "bloque", salt, hash },
      });
      assert.equal(reg.status, 500, reg.body);
      assert.match(JSON.parse(reg.body).error, /chmod 777/);
    } finally {
      await runner.unblockDataDir();
    }
  });
}

if (runner.request) {
  test("scripts/auth-user.mjs : le compte généré permet vraiment de se connecter", async () => {
    const { buildUserRecord } = await import("../scripts/auth-user.mjs");
    const record = buildUserRecord("admin", "Nouveau!Mot2Passe", { role: "editor", id: "admin" });
    runner.write("data/users.json", JSON.stringify([record], null, 2));

    const chal = await runner.request("api/auth/challenge.php", { query: { login: "admin" } });
    assert.equal(JSON.parse(chal.body).salt, record.salt);

    const hash = await client.hashPassword("Nouveau!Mot2Passe", record.salt);
    const login = await runner.request("api/auth/login.php", { method: "POST", body: { login: "admin", hash } });
    assert.equal(login.status, 200, login.body);
    assert.equal(JSON.parse(login.body).user.role, "editor");
    assert.equal(JSON.parse(login.body).migrated, false);

    const wrong = await runner.request("api/auth/login.php", {
      method: "POST",
      body: { login: "admin", hash: await client.hashPassword("autre-mot-de-passe", record.salt) },
    });
    assert.equal(wrong.status, 401);
  });
}

if (runner.request) {
  test("compte ancien dont le sel contient espaces et cyrillique : connexion préservée", async () => {
    const salt = "иван petrov-m1abc"; // ancien register.php : sel dérivé du login
    const h1 = clientHash("motdepasse", salt);
    runner.write(
      "data/users.json",
      JSON.stringify([{ id: "u_x", login: "иван", hash: h1, salt, createdAt: "2026-01-01T00:00:00Z", role: "reader" }], null, 2),
    );
    const chal = await runner.request("api/auth/challenge.php", { query: { login: "иван" } });
    assert.equal(JSON.parse(chal.body).salt, salt, "le sel stocké est renvoyé tel quel");
    const login = await runner.request("api/auth/login.php", { method: "POST", body: { login: "иван", hash: h1 } });
    assert.equal(login.status, 200, login.body);
    assert.equal(JSON.parse(login.body).migrated, true);
  });
}

if (runner.request) {
  test("tous les points d'entrée de l'API renvoient du JSON valide", async () => {
    const endpoints = [
      ["api/health.php", "GET", null],
      ["api/me.php", "GET", null],
      ["api/visits.php", "GET", null],
      ["api/dispatches.php", "GET", null],
      ["api/visit.php", "POST", { language: "fr" }],
      ["api/auth/challenge.php", "GET", null],
      ["api/auth/me.php", "GET", null],
      ["api/auth/logout.php", "POST", {}],
    ];
    for (const [script, method, body] of endpoints) {
      const res = await runner.request(script, { method, body, query: { login: "okno" } });
      assert.equal(res.error, undefined, script + " : " + (res.error || ""));
      assert.ok(res.status >= 200 && res.status < 300, script + " -> HTTP " + res.status);
      let parsed = null;
      assert.doesNotThrow(() => {
        parsed = JSON.parse(res.body);
      }, script + " : sortie non JSON → " + res.body.slice(0, 120));
      assert.equal(typeof parsed, "object");
    }
  });
}
