import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { loadAuth } from "./helpers/load-auth.mjs";

const nodeSha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const cases = [
  "",
  "a",
  "abc",
  "okno",
  "motdepasse",
  "а".repeat(1),           // 2 octets UTF-8
  "окно2026",              // cyrillique
  "x".repeat(55),          // dernière longueur sans bloc de padding supplémentaire
  "x".repeat(56),
  "x".repeat(63),
  "x".repeat(64),
  "x".repeat(65),
  "y".repeat(119),
  "z".repeat(120),
  "😀окно",                // 4 octets UTF-8 (paire de substitution)
  "p".repeat(1000),
  randomBytes(40).toString("latin1"),
];

test("sha256HexJs (repli JS pur, utilisé en http simple) == sha256 de Node", async (t) => {
  const { auth } = loadAuth({ ids: [] });
  for (const input of cases) {
    await t.test(`longueur ${input.length}`, () => {
      assert.equal(auth.sha256HexJs(input), nodeSha(input));
    });
  }
});

test("sha256Hex utilise Web Crypto quand il est disponible", async () => {
  const { auth } = loadAuth({ ids: [], subtle: true });
  assert.equal(await auth.sha256Hex("окно-2026"), nodeSha("окно-2026"));
});

test("sha256Hex retombe sur le JS pur sans crypto.subtle (http://)", async () => {
  const { auth } = loadAuth({ ids: [], subtle: false });
  assert.equal(await auth.sha256Hex("окно-2026"), nodeSha("окно-2026"));
});

test("utf8 de repli (sans TextEncoder) == utf8 de Node", async () => {
  const { auth } = loadAuth({ ids: [], textEncoder: false });
  for (const input of cases) {
    assert.equal(auth.sha256HexJs(input), nodeSha(input), input.slice(0, 12));
  }
});

test("hashPassword = sha256(mot_de_passe + sel)", async () => {
  const { auth } = loadAuth({ ids: [] });
  assert.equal(await auth.hashPassword("motdepasse", "okno-2026"), nodeSha("motdepasse" + "okno-2026"));
});

test("randomSalt renvoie 16 caractères hexadécimaux", async () => {
  const { auth } = loadAuth({ ids: [] });
  const salt = auth.randomSalt(8);
  assert.match(salt, /^[0-9a-f]{16}$/);
});

test("les deux copies de auth.js sont identiques", async () => {
  const fs = await import("node:fs");
  const a = fs.readFileSync(new URL("../public/auth/auth.js", import.meta.url), "utf8");
  const b = fs.readFileSync(new URL("../infinityfree/htdocs/auth/auth.js", import.meta.url), "utf8");
  assert.equal(a, b);
});
