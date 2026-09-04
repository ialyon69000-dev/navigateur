/**
 * API commentaires de la version Node : /api/comments.
 *
 * Règle à protéger : écrire un message reste réservé à la rédaction (rôle
 * « editor »), mais tout utilisateur connecté — lecteur comme éditeur — peut
 * commenter les messages publiés par la rédaction dans dashboard.html.
 *
 *   • l'auteur d'un commentaire est toujours le login de session, jamais une
 *     valeur du client ;
 *   • un lecteur ne commente que les messages publiés : les brouillons (et
 *     leurs commentaires) ne sortent pas vers lui ;
 *   • la rédaction voit tout (brouillons compris) et modère l'ensemble ;
 *   • chacun retire son propre commentaire ;
 *   • retirer un message emporte ses commentaires.
 */
import test from "node:test";
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okno-comments-"));
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
  path.join(dataDir, "comments.json"),
  JSON.stringify([
    { id: "c_old", messageId: "m_1", author: "claire", body: "D'accord avec la rédaction.", createdAt: "2026-08-22T08:00:00Z", updatedAt: "2026-08-22T08:00:00Z" },
    { id: "c_draft", messageId: "m_2", author: "okno", body: "Note interne au brouillon.", createdAt: "2026-08-22T09:00:00Z", updatedAt: "2026-08-22T09:00:00Z" },
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

const readComments = () => JSON.parse(fs.readFileSync(path.join(dataDir, "comments.json"), "utf8"));

test("lecture : publiés pour tout le monde, brouillons pour la rédaction seule", async () => {
  const anon = await req("/api/comments");
  assert.equal(anon.status, 200);
  assert.deepEqual(anon.json.items.map((c) => c.id), ["c_old"], "le commentaire du brouillon ne sort pas vers un visiteur");

  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const readerView = await req("/api/comments", { cookie: reader });
  assert.deepEqual(readerView.json.items.map((c) => c.id), ["c_old"], "le lecteur ne voit pas le commentaire du brouillon");

  const admin = await cookieFor("okno", "adminpass", "salt-a");
  const adminView = await req("/api/comments", { cookie: admin });
  assert.deepEqual(
    adminView.json.items.map((c) => c.id),
    ["c_old", "c_draft"],
    "la rédaction voit tout, du plus ancien au plus récent"
  );

  const filtered = await req("/api/comments?messageId=m_2", { cookie: admin });
  assert.deepEqual(filtered.json.items.map((c) => c.id), ["c_draft"], "?messageId= filtre par message");
});

test("écrire : 401 sans session, lecteur et éditeur connectés peuvent commenter", async () => {
  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const admin = await cookieFor("okno", "adminpass", "salt-a");

  const noSession = await req("/api/comments", { method: "POST", body: { messageId: "m_1", body: "x" } });
  assert.equal(noSession.status, 401);
  assert.equal(noSession.json.code, "auth-required");

  // le lecteur commente un message publié ; l'auteur vient de la session
  const byReader = await req("/api/comments", {
    method: "POST",
    cookie: reader,
    body: { messageId: "m_1", body: "C'est mieux en clair.", author: "pirate" },
  });
  assert.equal(byReader.status, 200, byReader.text);
  const item = byReader.json.item;
  assert.ok(item && item.id.startsWith("c_"), "l'objet est renvoyé");
  assert.equal(item.messageId, "m_1");
  assert.equal(item.author, "claire", "l'auteur est le login de session, jamais celui du client");

  const saved = readComments().find((c) => c.id === item.id);
  assert.ok(saved, "le commentaire est écrit dans data/comments.json");
  assert.equal(saved.body, "C'est mieux en clair.");
  assert.match(saved.createdAt, /^\d{4}-\d{2}-\d{2}T/);

  // un brouillon reste hors de portée des lecteurs
  const onDraft = await req("/api/comments", { method: "POST", cookie: reader, body: { messageId: "m_2", body: "je ne devrais pas pouvoir" } });
  assert.equal(onDraft.status, 404);
  assert.equal(onDraft.json.code, "message-not-found");

  const unknown = await req("/api/comments", { method: "POST", cookie: reader, body: { messageId: "m_zzz", body: "x" } });
  assert.equal(unknown.status, 404);

  // texte vide ou trop long : refusé / borné
  const empty = await req("/api/comments", { method: "POST", cookie: reader, body: { messageId: "m_1", body: "   " } });
  assert.equal(empty.status, 400);
  assert.equal(empty.json.code, "comment-required");

  const longBody = "а".repeat(800);
  const longOne = await req("/api/comments", { method: "POST", cookie: reader, body: { messageId: "m_1", body: longBody } });
  assert.equal(longOne.status, 200, longOne.text);
  assert.equal(longOne.json.item.body.length, 600, "le corps est borné à 600 caractères");

  // la rédaction commente aussi ses brouillons (ils restent internes)
  const byEditor = await req("/api/comments", { method: "POST", cookie: admin, body: { messageId: "m_2", body: "Idée pour plus tard." } });
  assert.equal(byEditor.status, 200, byEditor.text);
  assert.equal(byEditor.json.item.author, "okno");
});

test("supprimer : son propre commentaire, ou n'importe lequel pour la rédaction", async () => {
  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const admin = await cookieFor("okno", "adminpass", "salt-a");

  const noSession = await req("/api/comments?id=c_old", { method: "DELETE", body: {} });
  assert.equal(noSession.status, 401);

  const other = await req("/api/comments?id=c_draft", { method: "DELETE", cookie: reader, body: {} });
  assert.equal(other.status, 403);
  assert.equal(other.json.code, "not-owner");

  const unknown = await req("/api/comments?id=c_introuvable", { method: "DELETE", cookie: reader, body: {} });
  assert.equal(unknown.status, 404);

  // l'auteur retire le sien
  const own = await req("/api/comments?id=c_old", { method: "DELETE", cookie: reader, body: {} });
  assert.equal(own.status, 200, own.text);
  assert.equal(readComments().some((c) => c.id === "c_old"), false, "retiré du fichier");

  // la rédaction modère : elle retire un commentaire de lectrice
  const moderate = await req("/api/comments", { method: "POST", cookie: reader, body: { messageId: "m_1", body: "à modérer" } });
  const victimId = moderate.json.item.id;
  const asAdmin = await req(`/api/comments?id=${victimId}`, { method: "DELETE", cookie: admin, body: {} });
  assert.equal(asAdmin.status, 200, asAdmin.text);
  assert.equal(readComments().some((c) => c.id === victimId), false);
});

test("retirer un message emporte ses commentaires", async () => {
  const reader = await cookieFor("claire", "readerpass", "salt-r");
  const admin = await cookieFor("okno", "adminpass", "salt-a");

  const post = await req("/api/comments", { method: "POST", cookie: reader, body: { messageId: "m_1", body: "vivra-t-il ?" } });
  const cid = post.json.item.id;
  const del = await req("/api/messages?id=m_1", { method: "DELETE", cookie: admin, body: {} });
  assert.equal(del.status, 200, del.text);
  assert.equal(readComments().some((c) => c.id === cid), false, "le commentaire du message supprimé est nettoyé");
});
