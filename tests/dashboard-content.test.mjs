/**
 * Le tableau de bord, côté client : deux bugs remontés, deux garde-fous.
 *
 *   1. les rôles étaient écrits en dur en russe (« Редактор » / « Читатель ») :
 *      ils doivent venir du dictionnaire RU/EN et se retraduire au changement de
 *      langue, comme le reste de l'interface ;
 *   2. les utilisateurs voyaient la source des flux dans dashboard.html : un
 *      lecteur ne doit plus ni la voir ni la recevoir, et ne lit que les messages
 *      publiés par l'admin — qui, lui, gère la bande ET ces messages.
 *
 * Les deux copies du projet (public/ et infinityfree/htdocs/) sont exercées.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadPage, REPO_ROOT } from "./helpers/minidom.mjs";

const MESSAGES = {
  ok: true,
  items: [
    {
      id: "m_1",
      title: { ru: "Планёрка в 18:00", en: "Newsroom call at 18:00" },
      body: { ru: "Текст сообщения.", en: "Message text." },
      active: true,
      author: "okno",
      updatedAt: "2026-08-28T09:00:00Z",
    },
    {
      id: "m_2",
      title: { ru: "Черновик выпуска", en: "Draft edition" },
      body: { ru: "Не показывать.", en: "Do not show." },
      active: false,
      author: "okno",
      updatedAt: "2026-08-28T08:00:00Z",
    },
  ],
};

const DISPATCHES = {
  ok: true,
  updatedAt: "2026-08-28T10:00:00Z",
  items: [
    { id: "d_1", category: "Политика", source: "TASS", sourceId: "tass", title: "Заголовок депеши", publishedAt: "2026-08-28T09:15:00Z" },
  ],
};

const ADMIN_IDS = {
  "sec-msg-admin": ["admin-only"],
  "sec-flux": ["admin-only"],
  "stat-card-flux": ["admin-only"],
};

for (const prefix of ["public", "infinityfree/htdocs"]) {
  test(`[${prefix}] un lecteur : des rôles traduits, aucune source de flux`, async () => {
    const page = loadPage({
      i18n: `${prefix}/i18n.js`,
      scripts: [`${prefix}/dashboard.js`],
      classes: ADMIN_IDS,
      lang: "ru",
      routes: {
        "/api/auth/me": { ok: true, user: { id: "u_1", login: "jean", role: "reader", createdAt: "2026-08-20T00:00:00Z" } },
        "/api/messages": MESSAGES,
        "/api/dispatches": DISPATCHES,
      },
    });
    await page.settle();

    // rôle : un libellé du dictionnaire, jamais une chaîne du serveur
    assert.equal(page.el("stat-role").textContent, "Читатель");
    assert.match(page.el("stat-role-note").textContent, /источников/, "la note décrit les droits du lecteur");

    // les blocs d'administration restent masqués
    for (const id of ["sec-msg-admin", "sec-flux", "stat-card-flux"]) {
      assert.equal(page.el(id).classList.contains("is-admin"), false, `${id} masqué au lecteur`);
      assert.equal(page.el(id).hasAttribute("hidden"), true, `${id} porte l'attribut hidden`);
    }

    // aucune requête vers la bande : la source des flux ne transite pas
    assert.equal(page.calls.some((c) => c.pathname === "/api/dispatches"), false, "/api/dispatches ne doit pas être demandé");
    assert.equal(page.el("disp-body").innerHTML, "", "aucune ligne de flux dans le tableau du lecteur");
    assert.equal(page.el("stat-dispatches").textContent, "", "le compteur de dépêches n'est jamais rempli pour un lecteur");

    // messages publiés seulement (le brouillon m_2 reste côté serveur)
    assert.match(page.el("msg-list").innerHTML, /Планёрка в 18:00/);
    assert.doesNotMatch(page.el("msg-list").innerHTML, /Черновик выпуска/, "un brouillon n'est pas affiché");
    assert.equal(page.el("stat-messages").textContent, "1", "seul le message publié est compté");

    // ——— changer de langue retraduit le rôle et les messages ———
    page.setLang("en");
    await page.settle(2);
    assert.equal(page.el("stat-role").textContent, "Reader", "le rôle suit la langue");
    assert.match(page.el("msg-list").innerHTML, /Newsroom call at 18:00/, "le message suit la langue");
    assert.doesNotMatch(page.el("msg-list").innerHTML, /Планёрка/);
  });

  test(`[${prefix}] un admin gère la bande et les messages`, async () => {
    const posted = [];
    const page = loadPage({
      i18n: `${prefix}/i18n.js`,
      scripts: [`${prefix}/dashboard.js`],
      classes: ADMIN_IDS,
      lang: "ru",
      routes: {
        "/api/auth/me": { ok: true, user: { id: "admin", login: "okno", role: "editor", createdAt: "2026-08-27T00:00:00Z" } },
        "/api/messages": (call) => {
          if (call.method === "POST") {
            posted.push(call);
            return { ok: true, items: MESSAGES.items };
          }
          return MESSAGES;
        },
        "/api/dispatches": DISPATCHES,
      },
    });
    await page.settle();

    assert.equal(page.el("stat-role").textContent, "Редактор");
    for (const id of ["sec-msg-admin", "sec-flux"]) {
      assert.equal(page.el(id).classList.contains("is-admin"), true, `${id} visible pour l'admin`);
      assert.equal(page.el(id).hasAttribute("hidden"), false, `${id} pas masqué`);
    }

    // l'admin reçoit la bande, sources comprises, et voit ses brouillons
    assert.equal(page.calls.some((c) => c.pathname === "/api/dispatches"), true);
    assert.match(page.el("disp-body").innerHTML, /TASS/, "la colonne Source existe pour la rédaction");
    assert.match(page.el("disp-body").innerHTML, /data-act="delete"/, "chaque ligne est éditable");
    assert.match(page.calls.find((c) => c.url.startsWith("/api/messages")).url, /all=1/, "l'admin réclame les brouillons");
    assert.match(page.el("msg-admin-list").innerHTML, /Черновик выпуска/, "la liste d'admin montre le brouillon");

    // ——— enregistrer un message : bilingue, auteur = la session, jamais le client ———
    page.el("msg-title-ru").value = "Новое";
    page.el("msg-title-en").value = "New one";
    page.el("msg-body-ru").value = "Текст";
    page.el("msg-body-en").value = "Body";
    page.el("msg-active").checked = true;
    page.el("msg-form").dispatch("submit");
    await page.settle();

    assert.equal(posted.length, 1, "une seule requête d'écriture");
    const sent = JSON.parse(posted[0].body);
    assert.deepEqual(sent.title, { ru: "Новое", en: "New one" });
    assert.deepEqual(sent.body, { ru: "Текст", en: "Body" });
    assert.equal(sent.active, true);
    assert.equal("author" in sent, false, "le client n'impose pas l'auteur");
    assert.equal(page.el("msg-status").textContent.length > 0, true, "un retour visuel est affiché");

    page.setLang("en");
    await page.settle(2);
    assert.equal(page.el("stat-role").textContent, "Editor");
    assert.equal(page.el("msg-form-title").textContent, "New message");
  });
}

test("les rôles viennent du dictionnaire, jamais d'une chaîne en dur", () => {
  const files = [
    "public/dashboard.js",
    "infinityfree/htdocs/dashboard.js",
    "public/dispatches.js",
    "infinityfree/htdocs/dispatches.js",
    "public/dashboard.html",
    "infinityfree/htdocs/dashboard.html",
  ];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    assert.doesNotMatch(src, /"(Редактор|Читатель)"\s*[?:]/, `${rel} écrit un rôle en dur au lieu de le traduire`);
    if (rel.endsWith(".js")) {
      assert.doesNotMatch(src, /role\s*===?\s*"editor"\s*\?/, `${rel} déduit un libellé de rôle lui-même`);
      if (!/dispatches/.test(rel) || /roleLabel/.test(src)) {
        assert.match(src, /roleLabel|admin-only/, `${rel} doit passer par OKNO.roleLabel / .admin-only`);
      }
    }
  }
  // le dictionnaire des deux versions est le même et connaît trois rôles
  const ru = [];
  for (const rel of ["public/i18n.js", "infinityfree/htdocs/i18n.js"]) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
    for (const key of ["role.reader", "role.editor", "role.admin"]) {
      assert.ok(src.includes(`"${key}"`), `${rel} doit définir ${key}`);
    }
    assert.ok(src.includes("window.OKNO.roleLabel"), `${rel} doit exposer roleLabel`);
    ru.push(src);
  }
  assert.equal(ru[0], ru[1], "les deux copies de i18n.js doivent rester identiques");
});
