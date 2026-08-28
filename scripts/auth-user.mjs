#!/usr/bin/env node
/**
 * Génère un enregistrement de compte pour data/users.json — utile pour créer un
 * compte administrateur ou RÉINITIALISER un mot de passe perdu (les deux
 * versions, Node et PHP, partagent exactement le même format de fichier).
 *
 * Usage :
 *   node scripts/auth-user.mjs <login> <mot_de_passe> [--role editor] [--id admin]
 *
 * Puis remplacer/ajouter l'objet affiché dans :
 *   data/users.json                        (version Node)
 *   infinityfree/htdocs/data/users.json    (version PHP / InfinityFree)
 *
 * Aucun mot de passe n'est stocké : sel aléatoire + double sha256, comme le
 * fait le site lui-même.
 */
import { createHash, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

const sha256 = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

export function buildUserRecord(login, password, opts = {}) {
  const salt = opts.salt || randomBytes(8).toString("hex");
  const clientHash = sha256(password + salt); // ce que le navigateur envoie
  return {
    id: opts.id || "u_" + Date.now().toString(36) + "_" + randomBytes(2).toString("hex"),
    login: String(login),
    hash: sha256(clientHash + salt), // H2 = sha256(H1 + sel)
    salt,
    scheme: 2,
    createdAt: new Date().toISOString(),
    role: opts.role || "reader",
  };
}

function main(argv) {
  const args = argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  const [login, password] = positional;
  if (!login || !password) {
    console.error("Usage : node scripts/auth-user.mjs <login> <mot_de_passe> [--role editor] [--id admin]");
    process.exit(2);
  }
  const record = buildUserRecord(login, password, flags);
  console.log("Ajoutez (ou remplacez par) cet objet dans data/users.json :\n");
  console.log(JSON.stringify(record, null, 2));
  console.log("\nRappel : data/users.json est un tableau [ … ] — gardez les crochets et les virgules.");
  console.log("Sur InfinityFree : éditez le fichier dans le File Manager, puis chmod 666 data/users.json.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv);
}
