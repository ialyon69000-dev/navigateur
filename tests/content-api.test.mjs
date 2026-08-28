/**
 * API contenu de la version Node : /api/messages et /api/dispatches.
 *
 * Règle à protéger : la rédaction (rôle « editor ») gère les flux ET les messages
 * lus par les utilisateurs dans dashboard.html ; un lecteur ne peut rien écrire et
 * ne reçoit jamais les brouillons. Les libellés de rôle, eux, ne sortent pas du
 * serveur — le client les traduit (voir tests/dashboard-content.test.mjs).
 */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
// H2 = sha256(H1 + sel), H1 = sha256(mot_de_passe + sel) calculé par le navigateur.
const account = (id, login, role, password, salt) => ({
  id,
  login,
  hash: sha(sha(password + salt) + salt),
  salt,
  scheme: 2,
  createdAt: "2026-08-20T00:00:00Z",
  role,
});

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okno-content-"));
fs.writeFileSync(
  path.join(dataDir, "users.json"),
  JSON.stringify([
    account("admin", "okno", "editor", "adminpass", "salt-a"),
    account("u_read", "claire", "reader", "readerpass", "salt-r"),
  ], null, 2),
);
fs.writeFileSync(
  path.join(dataDir, "messages.json"),
  JSON.stringify([
    { id: "m_1", title: { ru: "Опубликовано", en: "Published" }, body: { ru: "да", en: "yes" }, active: true, author: "okno", createdAt: "2026-08-19T00:00:00Z", updatedAt: "2026-08-19T00:00:00Z" },
    { id: "m_2", title: { ru: "Черновик", en: "Draft" }, body: { ru: "нет", en: "no" }, active: false, author: "okno", createdAt: "2026-08-20T00:00:00Z", updatedAt: "2026-08-20T00:00:00Z" },
  ], null, 2),
);
fs.writeFileSync(
  path.join(dataDir, "dispatches.json"),
  JSON.stringify([
    { id: "d_1", category: "Политика", source: "TASS", sourceId: "tass", title: "Вчерашняя", summary: "", publishedAt: "2026-08-19T09:00:00Z", image: null, link: "#" },
  ], null, 2),
);
process.env.DATA_DIR = dataDir;

const { app } = await import(path.join(process.cwd(), "server.js"));
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function req(url, { method = "GET", body = null, cookie = "" } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === null ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

async function cookieFor(login, password, salt) {
  const res = await fetch(base + "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, hash: sha(password + salt) }),
  });
  assert.equal(res.status, 200, `login ${login}`);
  return "okno-session=" + res.headers.getSetCookie()[0].match(/okno-session=([^;]+)/)[1];
}

const readMessages = () => JSON.parse(fs.readFileSync(path.join(dataDir, "messages.json"), "utf8"));
const readDispatches = () => JSON.parse(fs.readFileSync(path.join(dataDir, "dispatches.json"), "utf8"));

test("lecture des messages : publiés pour tout le monde, brouillons pour la rédaction seule", async () => {
  const anon = await req("/api/messages");
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.json.items.map((m) => m.id), ["m_1"], "aucun brouillon ne fuit vers un visiteur");

  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const readerAll = await req("/api/messages?all=1", { cookie: reader });
  assert.deepEqual(readerAll.json.items.map((m) => m.id), ["m_1"], "?all=1 n'ouvre rien à un lecteur");

  const admin = await cookieFor("okno", "adminpass", "salt-a");
  const adminAll = await req("/api/messages?all=1", { cookie: admin });
  assert.deepEqual(adminAll.json.items.map((m) => m.id), ["m_2", "m_1"], "l'admin voit ses brouillons, les plus récents d'abord");
});

test("écriture : 401 sans session, 403 pour un lecteur, OK pour la rédaction", async () => {
  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const admin = await cookieFor("okno", "adminpass", "salt-a");

  const noSession = await req("/api/messages", { method: "POST", body: { title: { ru: "x" } } });
  assert.equal(noSession.status, 401);
  assert.equal(noSession.json.code, "auth-required");

  const asReader = await req("/api/messages", { method: "POST", body: { title: { ru: "x" } }, cookie: reader });
  assert.equal(asReader.status, 403);
  assert.equal(asReader.json.code, "admin-required");
  assert.equal(readMessages().length, 2, "rien n'a été écrit");

  const delReader = await req("/api/messages?id=m_1", { method: "DELETE", cookie: reader, body: {} });
  assert.equal(delReader.status, 403, "un lecteur ne supprime pas");

  const created = await req("/api/messages", {
    method: "POST",
    cookie: admin,
    body: { title: { ru: "Планёрка", en: "Newsroom call" }, body: { ru: "В 18:00", en: "At 18:00" }, active: true, author: "faux" },
  });
  assert.equal(created.status, 200, created.text);
  const saved = readMessages();
  const fresh = saved.find((m) => m.title.ru === "Планёрка");
  assert.ok(fresh && fresh.id.startsWith("m_"), "le message est dans data/messages.json");
  assert.deepEqual(fresh.title, { ru: "Планёрка", en: "Newsroom call" }, "les deux langues sont stockées");
  assert.equal(fresh.author, "okno", "l'auteur vient de la session, pas du client");
  assert.equal(saved[0].id, fresh.id, "une nouveauté passe en tête");

  // publier / retirer : la requête ne porte que « active », le texte doit survivre
  const toggle = await req("/api/messages", { method: "POST", cookie: admin, body: { id: fresh.id, active: false } });
  assert.equal(toggle.status, 200, toggle.text);
  const after = readMessages().find((m) => m.id === fresh.id);
  assert.equal(after.active, false);
  assert.deepEqual(after.title, { ru: "Планёрка", en: "Newsroom call" }, "mise à jour partielle sans perte");

  const unknown = await req("/api/messages", { method: "POST", cookie: admin, body: { id: "m_inexistant", active: true } });
  assert.equal(unknown.status, 404, "un id inconnu n'est pas une création déguisée");
  const empty = await req("/api/messages", { method: "POST", cookie: admin, body: { title: { ru: "", en: "" } } });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, "title-required");

  // un texte trop long est tronqué, un caractère de contrôle échappe
  const long = await req("/api/messages", { method: "POST", cookie: admin, body: { title: { ru: "A".repeat(400), en: "" }, body: { ru: "lu\u0000ne", en: "" } } });
  const truncated = readMessages().find((m) => m.id === long.json.items[0].id);
  assert.equal(truncated.title.ru.length, 160, "titre borné à 160 signes");
  assert.equal(truncated.body.ru, "lu ne", "caractères de contrôle neutralisés");

  const removed = await req(`/api/messages?id=${fresh.id}`, { method: "DELETE", cookie: admin, body: {} });
  assert.equal(removed.status, 200, removed.text);
  assert.equal(readMessages().some((m) => m.id === fresh.id), false);
});

test("bande : la rédaction garde la main sur les flux et leurs sources", async () => {
  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const admin = await cookieFor("okno", "adminpass", "salt-a");

  const list = await req("/api/dispatches");
  assert.equal(list.status, 200);
  assert.equal(list.json.items[0].source, "TASS", "la page publique continue d'afficher les sources");

  const asReader = await req("/api/dispatches", { method: "POST", cookie: reader, body: { title: "x" } });
  assert.equal(asReader.status, 403);
  assert.equal(readDispatches().length, 1, "rien n'a été ajouté par un lecteur");

  const add = await req("/api/dispatches", {
    method: "POST",
    cookie: admin,
    body: { category: "Мир", source: "TASS", title: "Dépesche du jour", link: "javascript:alert(1)", image: "https://example.com/a.jpg" },
  });
  assert.equal(add.status, 200, add.text);
  const saved = readDispatches();
  const fresh = saved.find((d) => d.title === "Dépesche du jour");
  assert.equal(fresh.source, "TASS", "la source est enregistrée");
  assert.equal(fresh.sourceId, "tass", "identifiant de source dérivé, minuscule");
  assert.equal(fresh.link, null, "un lien javascript: est rejeté");
  assert.match(fresh.publishedAt, /^\d{4}-\d{2}-\d{2}T/, "date ISO par défaut");
  assert.equal(saved[0].id, fresh.id);

  // édition : seuls les champs fournis changent
  const edit = await req("/api/dispatches", { method: "POST", cookie: admin, body: { id: fresh.id, title: "Titre corrigé" } });
  assert.equal(edit.status, 200, edit.text);
  const edited = readDispatches().find((d) => d.id === fresh.id);
  assert.equal(edited.title, "Titre corrigé");
  assert.equal(edited.source, "TASS", "la source survit à l'édition");

  const del = await req(`/api/dispatches?id=${fresh.id}`, { method: "DELETE", cookie: admin, body: {} });
  assert.equal(del.status, 200, del.text);
  assert.equal(readDispatches().some((d) => d.id === fresh.id), false, "retirée de la bande");
  const delAgain = await req(`/api/dispatches?id=${fresh.id}`, { method: "DELETE", cookie: admin, body: {} });
  assert.equal(delAgain.status, 404);
});

test("data/ illisible : un vrai 500 plutôt qu'un faux « ok »", async (t) => {
  const admin = await cookieFor("okno", "adminpass", "salt-a");
  const target = path.join(dataDir, "messages.json");
  const before = fs.statSync(target).mode;
  fs.chmodSync(target, 0o444);
  fs.chmodSync(dataDir, 0o555);
  try {
    const probe = await req("/api/messages", { method: "POST", cookie: admin, body: { title: { ru: "pas écrit" } } });
    if (probe.status === 500) {
      assert.equal(probe.json.code, "write-failed");
      assert.match(probe.json.error, /data\//);
      assert.equal(readMessages().some((m) => m.title.ru === "pas écrit"), false);
    } else {
      t.skip("l'OS ignore la restriction de droits (exécution en root)");
    }
  } finally {
    fs.chmodSync(dataDir, 0o755);
    fs.chmodSync(target, before);
  }
});

test("le tableau de bord reste réservé aux comptes connectés", async () => {
  const anon = await fetch(base + "/dashboard.html", { redirect: "manual" });
  assert.equal(anon.status, 302, "hors session : redirection vers la connexion");

  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const page = await fetch(base + "/dashboard.html", { headers: { cookie: reader } });
  const html = await page.text();
  assert.equal(page.status, 200);
  // Le lecteur ne reçoit que la coquille : à lui de demander les messages, la
  // bande n'est même pas demandée par dashboard.js tant que le rôle n'est pas editor.
  assert.match(html, /id="sec-flux"/);
  assert.match(html, /class="dash-section dash-admin admin-only"/);
  assert.match(html, /<tbody id="disp-body"><\/tbody>/, "le tableau des flux est vide dans la page servie");
  assert.doesNotMatch(html, /sourceId|publishedAt/, "aucune donnée de flux n'est embarquée dans la coquille");
  assert.doesNotMatch(html, /TASS|РИА|Lenta|Коммерсантъ/, "aucun nom de source n'est écrit dans la page du lecteur");
});

after(() => {
  server.closeAllConnections && server.closeAllConnections();
  server.close();
});
