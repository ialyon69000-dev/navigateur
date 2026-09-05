import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { loadAuth, scriptedFetch } from "./helpers/load-auth.mjs";

const nodeSha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const LOGIN_IDS = ["auth-form", "auth-error", "auth-submit", "login", "password"];
const REGISTER_IDS = ["auth-form", "auth-error", "auth-submit", "login", "password", "password2"];

for (const source of ["public/auth/auth.js", "infinityfree/htdocs/auth/auth.js"]) {
  test(`[${source}] le gestionnaire submit est bien attaché (bug du sélecteur "#auth-form")`, async () => {
    const dom = loadAuth({ source, ids: LOGIN_IDS });
    assert.equal(dom.ready, true, "window.OKNO_AUTH_READY doit être posé");
    assert.equal(dom.form.listenerCount("submit"), 1, "un seul gestionnaire submit doit être posé");
  });

  test(`[${source}] connexion : aucun envoi natif, aucun mot de passe en clair`, async () => {
    const fetcher = scriptedFetch([
      { match: "/api/auth/challenge", response: { ok: true, salt: "okno-2026", scheme: 2 } },
      { match: "/api/auth/login", response: { ok: true, user: { id: "admin", login: "okno", role: "editor" } } },
    ]);
    const dom = loadAuth({ source, ids: LOGIN_IDS, fetch: fetcher.impl });
    dom.elements.login.value = "okno";
    dom.elements.password.value = "motdepasse";

    const ev = dom.submit();
    assert.equal(ev.defaultPrevented, true, "la soumission native doit être annulée");
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(fetcher.calls.length, 2, "challenge + login");
    assert.match(fetcher.calls[0].url, /^\/api\/auth\/challenge\?login=okno$/);
    assert.equal(fetcher.calls[1].url, "/api/auth/login");
    assert.equal(fetcher.calls[1].method, "POST");

    const sent = fetcher.bodyOf(1);
    assert.deepEqual(Object.keys(sent).sort(), ["hash", "login"]);
    assert.equal(sent.login, "okno");
    assert.equal(sent.hash, nodeSha("motdepasse" + "okno-2026"), "hash = sha256(mot_de_passe + sel)");
    assert.doesNotMatch(fetcher.calls[1].body, /motdepasse/, "le mot de passe ne doit jamais apparaître dans la requête");
    assert.equal(fetcher.calls[1].options.credentials, "same-origin");
    assert.equal(dom.timers.length, 1, "redirection vers le tableau de bord programmée");
  });

  test(`[${source}] inscription : sel aléatoire + hash, jamais le mot de passe`, async () => {
    const fetcher = scriptedFetch([
      { match: "/api/auth/register", response: { ok: true, user: { id: "u_1", login: "testeur", role: "reader" } }, status: 201 },
    ]);
    const dom = loadAuth({ source, ids: REGISTER_IDS, fetch: fetcher.impl });
    dom.elements.login.value = "testeur";
    dom.elements.password.value = "motdepasse";
    dom.elements.password2.value = "motdepasse";

    const ev = dom.submit();
    assert.equal(ev.defaultPrevented, true);
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(fetcher.calls.length, 1);
    const sent = fetcher.bodyOf(0);
    assert.deepEqual(Object.keys(sent).sort(), ["hash", "login", "salt"]);
    assert.match(sent.salt, /^[0-9a-f]{16}$/);
    assert.equal(sent.hash, nodeSha("motdepasse" + sent.salt));
    assert.doesNotMatch(fetcher.calls[0].body, /motdepasse/);
  });

  test(`[${source}] un mot de passe en clair envoyé par une vieille copie est refusé et affiché`, async () => {
    const fetcher = scriptedFetch([
      { match: "/api/auth/challenge", response: { ok: true, salt: "okno-2026" } },
      {
        match: "/api/auth/login",
        status: 400,
        response: { ok: false, error: "Старая версия скрипта входа.", reason: "cleartext-password" },
      },
    ]);
    const dom = loadAuth({ source, ids: LOGIN_IDS, fetch: fetcher.impl });
    dom.elements.login.value = "okno";
    dom.elements.password.value = "motdepasse";
    dom.submit();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(dom.errorText(), "Старая версия скрипта входа.");
    assert.equal(dom.elements["auth-error"].classList.contains("show"), true);
  });

  test(`[${source}] une réponse HTML (challenge anti-bot / 404) produit un message, pas un silence`, async () => {
    const html = "<html><body>InfinityFree</body></html>";
    const fetcher = scriptedFetch([
      { match: "/api/auth/challenge", response: html, status: 200 },
      { match: "/api/auth/challenge.php", response: html, status: 200 },
    ]);
    const dom = loadAuth({ source, ids: LOGIN_IDS, fetch: fetcher.impl });
    dom.elements.login.value = "okno";
    dom.elements.password.value = "motdepasse";
    dom.submit();
    await new Promise((r) => setTimeout(r, 20));
    assert.match(dom.errorText(), /HTTP 200/);
    assert.equal(fetcher.calls.length, 2, "URL propre puis repli .php, tous deux en HTML");
    assert.equal(dom.elements["auth-submit"].disabled, false, "le bouton est réactivé");
  });

  test(`[${source}] repli automatique sur les URL .php si le .htaccess n'est pas à jour`, async () => {
    const fetcher = scriptedFetch([
      { match: "/api/auth/challenge", response: "<html>404 Not Found</html>", status: 404 },
      { match: "/api/auth/challenge.php", response: { ok: true, salt: "sel-1", scheme: 2 } },
      { match: "/api/auth/login", response: "<html>404 Not Found</html>", status: 404 },
      { match: "/api/auth/login.php", response: { ok: true, user: { id: "u1", login: "okno", role: "reader" } } },
    ]);
    const dom = loadAuth({ source, ids: LOGIN_IDS, fetch: fetcher.impl });
    dom.elements.login.value = "okno";
    dom.elements.password.value = "motdepasse";
    dom.submit();
    await new Promise((r) => setTimeout(r, 20));

    assert.deepEqual(
      fetcher.calls.map((c) => c.url),
      ["/api/auth/challenge?login=okno", "/api/auth/challenge.php?login=okno", "/api/auth/login.php"],
      "le .php est mémorisé : le login ne retente pas l'URL propre",
    );
    assert.equal(dom.errorText(), "auth.success");
  });

  test(`[${source}] une erreur métier (401) est traduite selon la langue de la page`, async () => {
    // Le serveur répond toujours en russe ; la page doit l'afficher dans la
    // langue choisie (OKNO.t est fourni par i18n.js dans un vrai navigateur).
    const L10N = {
      "authapi.err.invalid": { ru: "Неверный логин или пароль.", en: "Incorrect login or password." },
    };
    let lang = "ru";

    async function attempt() {
      const fetcher = scriptedFetch([
        { match: "/api/auth/challenge", response: { ok: true, salt: "sel-1" } },
        { match: "/api/auth/login", status: 401, response: { ok: false, error: "Неверный логин или пароль." } },
      ]);
      const dom = loadAuth({ source, ids: LOGIN_IDS, fetch: fetcher.impl });
      dom.window.OKNO = { t: (key) => (L10N[key] && L10N[key][lang]) || key };
      dom.elements.login.value = "okno";
      dom.elements.password.value = "mauvais";
      dom.submit();
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(fetcher.calls.length, 2, "pas de second essai sur une vraie réponse JSON");
      assert.equal(dom.elements["auth-error"].classList.contains("ok"), false, "erreur = style rouge, pas vert");
      return dom.errorText();
    }

    assert.equal(await attempt(), "Неверный логин или пароль.", "page en russe → message en russe");
    lang = "en";
    assert.equal(await attempt(), "Incorrect login or password.", "page en anglais → message traduit en anglais");
  });

  test(`[${source}] un blocage anti-brute force (429) est traduit selon la langue de la page`, async () => {
    const L10N = {
      "authapi.err.locked": {
        ru: "Слишком много попыток входа. Подождите немного.",
        en: "Too many sign-in attempts. Please wait a moment.",
      },
    };
    let lang = "en";
    const fetcher = scriptedFetch([
      { match: "/api/auth/challenge", response: { ok: true, salt: "sel-1" } },
      {
        match: "/api/auth/login",
        status: 429,
        response: { ok: false, error: "Слишком много попыток входа. Подождите немного.", reason: "too-many-attempts" },
      },
    ]);
    const dom = loadAuth({ source, ids: LOGIN_IDS, fetch: fetcher.impl });
    dom.window.OKNO = { t: (key) => (L10N[key] && L10N[key][lang]) || key };
    dom.elements.login.value = "okno";
    dom.elements.password.value = "mauvais";
    dom.submit();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(dom.errorText(), "Too many sign-in attempts. Please wait a moment.");
  });

  test(`[${source}] champs vides : message immédiat, aucune requête`, async () => {
    const fetcher = scriptedFetch([]);
    const dom = loadAuth({ source, ids: LOGIN_IDS, fetch: fetcher.impl });
    dom.submit();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(dom.errorText(), "auth.empty-fields");
    assert.equal(fetcher.calls.length, 0);
  });
}

test("l’invite d’inscription de la page de connexion est traduisible", async () => {
  const fs = await import("node:fs");
  for (const f of ["public/auth/login.html", "infinityfree/htdocs/auth/login.html"]) {
    const html = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.match(html, /data-i18n="auth\.no-account">Нет аккаунта\?<\/span>/, f);
  }
  for (const f of ["public/i18n.js", "infinityfree/htdocs/i18n.js"]) {
    const i18n = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.match(i18n, /"auth\.no-account": \{ ru: "Нет аккаунта\?", en: "Don’t have an account\?" \}/, f);
  }
});

test("sans auth.js le formulaire refuse de partir (garde-fou HTML)", async () => {
  const fs = await import("node:fs");
  for (const f of [
    "public/auth/login.html",
    "public/auth/register.html",
    "infinityfree/htdocs/auth/login.html",
    "infinityfree/htdocs/auth/register.html",
  ]) {
    const html = fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
    assert.match(html, /onsubmit="return window\.OKNO_AUTH_READY === true"/, f);
    assert.match(html, /id="auth-form" method="post"/, f + " : pas de GET natif");
  }
});
