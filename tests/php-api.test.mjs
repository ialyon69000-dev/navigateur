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
    // le sel attendu est lu dans le fichier seed lui-même : les deux versions
    // (Node et PHP) partagent le même compte, mais le sel vit dans data/users.json
    const seedUser = JSON.parse(await runner.read("data/users.json")).find((u) => u.login === "okno");
    assert.ok(seedUser, "le compte seed « okno » est présent dans data/users.json");
    assert.equal(JSON.parse(chalSeed.body).salt, seedUser.salt);

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
      ["api/messages.php", "GET", null],
      ["api/comments.php", "GET", null],
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

if (runner.request) {
  test("messages et bande : mêmes droits que la version Node", async () => {
    const pwd = "Contenu!2026";
    const mk = (id, login, role) => {
      const salt = "salt-" + id;
      const h1 = clientHash(pwd, salt);
      return { id, login, hash: nodeSha(h1 + salt), salt, scheme: 2, createdAt: "2026-08-01T00:00:00Z", role, _h1: h1 };
    };
    const admin = mk("admin", "okno", "editor");
    const lectrice = mk("u_read", "claire", "reader");
    runner.write(
      "data/users.json",
      JSON.stringify(
        [admin, lectrice].map(({ _h1, ...u }) => u),
        null,
        2,
      ),
    );
    const sidOf = async (login) => {
      const r = await runner.request("api/auth/login.php", { method: "POST", body: { login, hash: lectrice._h1 && login === "claire" ? lectrice._h1 : admin._h1 } });
      assert.equal(r.status, 200, r.body);
      return "okno-session=" + runner.cookieOf(r, "okno-session");
    };
    const adminCookie = await sidOf("okno");
    const readerCookie = await sidOf("claire");

    // point de départ : le fichier de la rédaction est celui livré dans le dépôt
    runner.write("data/messages.json", JSON.stringify([
      { id: "m_1", title: { ru: "Опубликовано", en: "Published" }, body: { ru: "да", en: "yes" }, active: true, author: "okno", createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
      { id: "m_2", title: { ru: "Черновик", en: "Draft" }, body: { ru: "нет", en: "no" }, active: false, author: "okno", createdAt: "2026-08-21T00:00:00Z", updatedAt: "2026-08-21T00:00:00Z" },
    ], null, 2));

    // ——— lecture : les lecteurs ne voient que le publié ———
    const anon = await runner.request("api/messages.php");
    assert.equal(anon.status, 200, anon.body);
    assert.deepEqual(JSON.parse(anon.body).items.map((m) => m.id), ["m_1"], "un brouillon ne sort pas");

    const readerAll = await runner.request("api/messages.php", { query: { all: "1" }, cookie: readerCookie });
    assert.deepEqual(JSON.parse(readerAll.body).items.map((m) => m.id), ["m_1"], "?all=1 ne force rien pour un lecteur");
    const adminAll = await runner.request("api/messages.php", { query: { all: "1" }, cookie: adminCookie });
    assert.deepEqual(JSON.parse(adminAll.body).items.map((m) => m.id), ["m_2", "m_1"], "l'admin voit ses brouillons, les plus récents d'abord");

    // ——— écriture : réservée à la rédaction ———
    const noSession = await runner.request("api/messages.php", { method: "POST", body: { title: { ru: "x" } } });
    assert.equal(noSession.status, 401, noSession.body);
    assert.equal(JSON.parse(noSession.body).code, "auth-required");

    const asReader = await runner.request("api/messages.php", { method: "POST", body: { title: { ru: "x" } }, cookie: readerCookie });
    assert.equal(asReader.status, 403, asReader.body);
    assert.equal(JSON.parse(asReader.body).code, "admin-required");

    const created = await runner.request("api/messages.php", {
      method: "POST",
      cookie: adminCookie,
      body: { title: { ru: "Планёрка", en: "Newsroom call" }, body: { ru: "В 18:00", en: "At 18:00" }, active: true, author: "fake" },
    });
    assert.equal(created.status, 200, created.body);
    const saved = JSON.parse(await runner.read("data/messages.json"));
    const fresh = saved.find((m) => m.title.ru === "Планёрка");
    assert.ok(fresh && fresh.id.startsWith("m_"), "l'objet est écrit dans data/messages.json");
    assert.deepEqual(fresh.title, { ru: "Планёрка", en: "Newsroom call" }, "les deux langues sont stockées");
    assert.equal(fresh.author, "okno", "l'auteur est le login de session, jamais celui du client");
    assert.equal(saved[0].id, fresh.id, "une nouveauté passe en tête");

    // ——— mise à jour partielle : publier / retirer ne vide pas le texte ———
    const toggled = await runner.request("api/messages.php", { method: "POST", cookie: adminCookie, body: { id: fresh.id, active: false } });
    assert.equal(toggled.status, 200, toggled.body);
    const afterToggle = JSON.parse(await runner.read("data/messages.json")).find((m) => m.id === fresh.id);
    assert.equal(afterToggle.active, false);
    assert.deepEqual(afterToggle.title, { ru: "Планёрка", en: "Newsroom call" }, "le titre est conservé");

    const unknown = await runner.request("api/messages.php", { method: "POST", cookie: adminCookie, body: { id: "m_inexistant", active: true } });
    assert.equal(unknown.status, 404, unknown.body);
    const empty = await runner.request("api/messages.php", { method: "POST", cookie: adminCookie, body: { title: { ru: "", en: "" } } });
    assert.equal(empty.status, 400, empty.body);
    assert.equal(JSON.parse(empty.body).code, "title-required");

    const removed = await runner.request("api/messages.php", { method: "DELETE", query: { id: fresh.id }, cookie: adminCookie });
    assert.equal(removed.status, 200, removed.body);
    assert.equal(JSON.parse(await runner.read("data/messages.json")).some((m) => m.id === fresh.id), false, "supprimé du fichier");
    const removeAgain = await runner.request("api/messages.php", { method: "DELETE", query: { id: fresh.id }, cookie: adminCookie });
    assert.equal(removeAgain.status, 404, removeAgain.body);

    // ——— la bande : l'admin voit les sources, le lecteur n'écrit pas ———
    const fluxReader = await runner.request("api/dispatches.php", { method: "POST", cookie: readerCookie, body: { title: "x" } });
    assert.equal(fluxReader.status, 403, fluxReader.body);
    const fluxAdd = await runner.request("api/dispatches.php", {
      method: "POST",
      cookie: adminCookie,
      body: { category: "Мир", source: "TASS", title: "Депеша", link: "javascript:alert(1)", image: "https://example.com/a.jpg" },
    });
    assert.equal(fluxAdd.status, 200, fluxAdd.body);
    const flux = JSON.parse(await runner.read("data/dispatches.json"));
    // Le titre est bilingue { ru, en } depuis que la bande a suivi les messages.
    const added = flux.find((d) => (d.title && d.title.ru === "Депеша") || d.title === "Депеша");
    assert.ok(added && added.id.startsWith("d_"), "la dépêche est ajoutée");
    assert.equal(added.source, "TASS", "la source est conservée pour la rédaction");
    assert.equal(added.sourceId, "tass", "un identifiant de source est dérivé");
    assert.equal(added.link, null, "un lien javascript: est rejeté");
    assert.match(added.publishedAt, /^\d{4}-\d{2}-\d{2}T/, "date de publication valide");

    const fluxDel = await runner.request("api/dispatches.php", { method: "DELETE", query: { id: added.id }, cookie: adminCookie });
    assert.equal(fluxDel.status, 200, fluxDel.body);

    // ——— méthode refusée ———
    const patch = await runner.request("api/messages.php", { method: "PATCH", cookie: adminCookie, body: "{}" });
    assert.equal(patch.status, 405, patch.body);
  });
}

if (runner.request) {
  test("commentaires : lecteur et éditeur connectés commentent, seuls les messages publiés", async () => {
    const pwd = "Contenu!2026";
    const mk = (id, login, role) => {
      const salt = "salt-c-" + id;
      const h1 = clientHash(pwd, salt);
      return { id, login, hash: nodeSha(h1 + salt), salt, scheme: 2, createdAt: "2026-08-01T00:00:00Z", role, _h1: h1 };
    };
    const admin = mk("admin", "okno", "editor");
    const lectrice = mk("u_read", "claire", "reader");
    runner.write(
      "data/users.json",
      JSON.stringify(
        [admin, lectrice].map(({ _h1, ...u }) => u),
        null,
        2,
      ),
    );
    runner.write("data/messages.json", JSON.stringify([
      { id: "m_1", title: { ru: "Опубликовано", en: "Published" }, body: { ru: "да", en: "yes" }, active: true, author: "okno", createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
      { id: "m_2", title: { ru: "Черновик", en: "Draft" }, body: { ru: "нет", en: "no" }, active: false, author: "okno", createdAt: "2026-08-21T00:00:00Z", updatedAt: "2026-08-21T00:00:00Z" },
    ], null, 2));
    // un commentaire ancien sur le message publié, un sur le brouillon
    runner.write("data/comments.json", JSON.stringify([
      { id: "c_old", messageId: "m_1", author: "claire", body: "D'accord avec la rédaction.", createdAt: "2026-08-22T08:00:00Z", updatedAt: "2026-08-22T08:00:00Z" },
      { id: "c_draft", messageId: "m_2", author: "okno", body: "Note interne au brouillon.", createdAt: "2026-08-22T09:00:00Z", updatedAt: "2026-08-22T09:00:00Z" },
    ], null, 2));

    const sidOf = async (login) => {
      const r = await runner.request("api/auth/login.php", { method: "POST", body: { login, hash: login === "claire" ? lectrice._h1 : admin._h1 } });
      assert.equal(r.status, 200, r.body);
      return "okno-session=" + runner.cookieOf(r, "okno-session");
    };
    const adminCookie = await sidOf("okno");
    const readerCookie = await sidOf("claire");

    // ——— lecture : anonyme et lecteur ne voient que les commentaires des messages publiés ———
    const anon = await runner.request("api/comments.php");
    assert.equal(anon.status, 200, anon.body);
    assert.deepEqual(JSON.parse(anon.body).items.map((c) => c.id), ["c_old"], "le commentaire du brouillon ne sort pas");

    const readerView = await runner.request("api/comments.php", { cookie: readerCookie });
    assert.deepEqual(JSON.parse(readerView.body).items.map((c) => c.id), ["c_old"], "le lecteur ne voit pas le commentaire du brouillon");

    const adminView = await runner.request("api/comments.php", { cookie: adminCookie });
    assert.deepEqual(JSON.parse(adminView.body).items.map((c) => c.id), ["c_old", "c_draft"], "la rédaction voit tout, du plus ancien au plus récent");

    const filtered = await runner.request("api/comments.php", { query: { messageId: "m_2" }, cookie: adminCookie });
    assert.deepEqual(JSON.parse(filtered.body).items.map((c) => c.id), ["c_draft"], "?messageId= filtre par message");

    // ——— écrire : 401 sans session ; le lecteur peut commenter un message publié ———
    const noSession = await runner.request("api/comments.php", { method: "POST", body: { messageId: "m_1", body: "x" } });
    assert.equal(noSession.status, 401, noSession.body);
    assert.equal(JSON.parse(noSession.body).code, "auth-required");

    const byReader = await runner.request("api/comments.php", {
      method: "POST",
      cookie: readerCookie,
      body: { messageId: "m_1", body: "C'est mieux en clair.", author: "pirate" },
    });
    assert.equal(byReader.status, 200, byReader.body);
    const item = JSON.parse(byReader.body).item;
    assert.ok(item && item.id.startsWith("c_"), "l'objet est écrit dans data/comments.json");
    assert.equal(item.messageId, "m_1");
    assert.equal(item.author, "claire", "l'auteur est le login de session, jamais celui du client");

    const afterReader = JSON.parse(await runner.read("data/comments.json"));
    const posted = afterReader.find((c) => c.id === item.id);
    assert.ok(posted, "le commentaire est dans le fichier");
    assert.equal(posted.body, "C'est mieux en clair.");
    assert.equal(posted.author, "claire");

    // ——— un brouillon reste hors de portée des lecteurs ———
    const onDraft = await runner.request("api/comments.php", { method: "POST", cookie: readerCookie, body: { messageId: "m_2", body: "je ne devrais pas pouvoir" } });
    assert.equal(onDraft.status, 404, onDraft.body);
    assert.equal(JSON.parse(onDraft.body).code, "message-not-found");

    // ——— la rédaction, elle, commente aussi ses brouillons ———
    const byEditor = await runner.request("api/comments.php", { method: "POST", cookie: adminCookie, body: { messageId: "m_2", body: "Idée pour plus tard." } });
    assert.equal(byEditor.status, 200, byEditor.body);
    const editorItem = JSON.parse(byEditor.body).item;
    assert.equal(editorItem.author, "okno");

    // ——— validation : message inconnu et texte vide ———
    const unknownMsg = await runner.request("api/comments.php", { method: "POST", cookie: readerCookie, body: { messageId: "m_zzz", body: "x" } });
    assert.equal(unknownMsg.status, 404, unknownMsg.body);
    const emptyBody = await runner.request("api/comments.php", { method: "POST", cookie: readerCookie, body: { messageId: "m_1", body: "   " } });
    assert.equal(emptyBody.status, 400, emptyBody.body);
    assert.equal(JSON.parse(emptyBody.body).code, "comment-required");

    // ——— suppression : l'auteur retire le sien, pas celui des autres ———
    const delOther = await runner.request("api/comments.php", { method: "DELETE", query: { id: editorItem.id }, cookie: readerCookie });
    assert.equal(delOther.status, 403, delOther.body);
    assert.equal(JSON.parse(delOther.body).code, "not-owner");

    const delOwn = await runner.request("api/comments.php", { method: "DELETE", query: { id: item.id }, cookie: readerCookie });
    assert.equal(delOwn.status, 200, delOwn.body);
    assert.equal(JSON.parse(await runner.read("data/comments.json")).some((c) => c.id === item.id), false, "retiré du fichier");

    // la rédaction modère : elle retire le commentaire de la lectrice restant
    const delModerate = await runner.request("api/comments.php", { method: "DELETE", query: { id: "c_old" }, cookie: adminCookie });
    assert.equal(delModerate.status, 200, delModerate.body);

    const delUnknown = await runner.request("api/comments.php", { method: "DELETE", query: { id: "c_introuvable" }, cookie: readerCookie });
    assert.equal(delUnknown.status, 404, delUnknown.body);

    // ——— retirer un message emporte ses commentaires ———
    const cascade = await runner.request("api/messages.php", { method: "DELETE", query: { id: "m_2" }, cookie: adminCookie });
    assert.equal(cascade.status, 200, cascade.body);
    assert.equal(JSON.parse(await runner.read("data/comments.json")).some((c) => c.messageId === "m_2"), false, "commentaires du message supprimé nettoyés");
  });
}
