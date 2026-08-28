/**
 * Deux façons d'exécuter les scripts PHP de l'API pour les tests :
 *   1. le binaire `php` local (PHP_BIN ou `php` dans le PATH) — un processus par requête ;
 *   2. php-wasm (@php-wasm/node) si aucun PHP n'est installé — utile en CI/sandbox.
 *
 * Dans les deux cas on travaille sur une COPIE de infinityfree/htdocs dans un
 * dossier temporaire : les tests écrivent dans data/ sans toucher au dépôt.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");

export function copyHtdocs() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "okno-php-"));
  fs.cpSync(path.join(REPO_ROOT, "infinityfree/htdocs"), path.join(tmp, "htdocs"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "tests/php"), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "tests/php/run-request.php"), path.join(tmp, "tests/php/run-request.php"));
  // data/ toujours vierge et inscriptible
  fs.writeFileSync(path.join(tmp, "htdocs/data/users.json"), fs.readFileSync(path.join(REPO_ROOT, "infinityfree/htdocs/data/users.json"), "utf8"));
  fs.writeFileSync(path.join(tmp, "htdocs/data/sessions.json"), "{}\n");
  return tmp;
}

function parseResult(stdout) {
  const lines = String(stdout).split("\n").filter((l) => l.trim() !== "");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (line.startsWith("{") && line.endsWith("}")) {
      try {
        return JSON.parse(line);
      } catch (e) {
        /* on continue */
      }
    }
  }
  return { status: 0, headers: [], body: String(stdout), error: "sortie PHP illisible" };
}

function cookieOf(result, name) {
  const hit = (result.headers || []).find((h) => /^set-cookie:/i.test(h) && h.toLowerCase().includes(name + "="));
  if (!hit) return null;
  const value = hit.split(":").slice(1).join(":").trim().split(";")[0];
  return value.split("=").slice(1).join("=");
}

function phpBinary() {
  const candidates = [process.env.PHP_BIN, "php", "php8", "php8.2", "php8.1", "php7.4"].filter(Boolean);
  for (const bin of candidates) {
    try {
      const out = spawnSync(bin, ["-v"], { encoding: "utf8" });
      if (out.status === 0 && /PHP/i.test(out.stdout || "")) return bin;
    } catch (e) {
      /* suivant */
    }
  }
  return null;
}

export async function createPhpRunner() {
  const tmp = copyHtdocs();
  const htdocs = path.join(tmp, "htdocs");
  const runnerFile = path.join(tmp, "tests/php/run-request.php");

  const bin = phpBinary();
  if (bin) {
    return {
      mode: "php:" + bin,
      root: tmp,
      htdocs,
      cookieOf,
      request(script, { method = "GET", body = null, cookie = "", query = null } = {}) {
        const args = [runnerFile, htdocs, script, method, body === null ? "" : JSON.stringify(body), cookie, JSON.stringify(query || {})];
        const out = spawnSync(bin, args, { encoding: "utf8" });
        const result = parseResult(out.stdout);
        if (out.stderr) result.stderr = out.stderr;
        return result;
      },
      write(rel, content) {
        fs.writeFileSync(path.join(htdocs, rel), content);
      },
      read(rel) {
        return fs.readFileSync(path.join(htdocs, rel), "utf8");
      },
      chmod(rel, mode) {
        fs.chmodSync(path.join(htdocs, rel), mode);
      },
      // Rend data/ non inscriptible ; renvoie false si l'OS ignore la demande
      // (exécution en root, par exemple).
      async blockDataDir() {
        try {
          fs.chmodSync(path.join(htdocs, "data"), 0o555);
          const probe = path.join(htdocs, "data", ".wtest");
          try {
            fs.writeFileSync(probe, "x");
            fs.unlinkSync(probe);
            return false;
          } catch (e) {
            return true;
          }
        } catch (e) {
          return false;
        }
      },
      async unblockDataDir() {
        try {
          fs.chmodSync(path.join(htdocs, "data"), 0o775);
        } catch (e) {
          /* déjà rétabli */
        }
      },
      close() {},
    };
  }

  let wasmPkg = null;
  let wasmSpecifier = null;
  for (const specifier of [process.env.PHP_WASM_PATH, "@php-wasm/node"].filter(Boolean)) {
    try {
      wasmPkg = await import(specifier);
      wasmSpecifier = specifier;
      break;
    } catch (e) {
      /* pas installé */
    }
  }
  if (!wasmPkg) {
    return { mode: "none", root: tmp, htdocs, cookieOf, request: null, close() {} };
  }
  // @php-wasm/universal doit être résolu depuis l'endroit où se trouve @php-wasm/node.
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  const req = createRequire(/^(\/|\.\.?\/|file:)/.test(wasmSpecifier) ? wasmSpecifier : import.meta.url);
  const universalCjs = req.resolve("@php-wasm/universal");
  // Il faut la copie ESM (index.js), celle qu'utilise @php-wasm/node : la copie
  // CJS tiendrait un registre de runtimes séparé.
  const universalEsm = path.join(path.dirname(universalCjs), "index.js");
  const universal = await import(pathToFileURL(fs.existsSync(universalEsm) ? universalEsm : universalCjs).href);
  const php = new universal.PHP(
    await wasmPkg.loadNodeRuntime("8.3", {
      emscriptenOptions: {
        processId: 1,
        bindUserSpace: (ctx) => wasmPkg.bindUserSpace({ fileLockManager: new wasmPkg.FileLockManagerForPosix() }, ctx),
      },
    }),
  );

  // Copie de l'arborescence dans le système de fichiers virtuel.
  const walk = (abs, virt) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const a = path.join(abs, entry.name);
      const v = virt + "/" + entry.name;
      if (entry.isDirectory()) {
        php.mkdirTree(v);
        walk(a, v);
      } else {
        php.writeFile(v, fs.readFileSync(a));
      }
    }
  };
  php.mkdirTree("/okno/tests/php");
  php.mkdirTree("/okno/htdocs");
  walk(htdocs, "/okno/htdocs");
  php.writeFile("/okno/tests/php/run-request.php", fs.readFileSync(runnerFile, "utf8"));

  return {
    mode: "php-wasm",
    root: tmp,
    htdocs,
    cookieOf,
    async request(script, { method = "GET", body = null, cookie = "", query = null } = {}) {
      const args = ["run-request.php", "/okno/htdocs", script, method, body === null ? "" : JSON.stringify(body), cookie, JSON.stringify(query || {})];
      const encoded = args.map((a) => "'" + Buffer.from(String(a), "utf8").toString("base64") + "'").join(",");
      const out = await php.runStream({
        code: `<?php\n$argv = array_map('base64_decode', [${encoded}]);\nrequire '/okno/tests/php/run-request.php';\n`,
      });
      return parseResult(await out.stdoutText);
    },
    write(rel, content) {
      php.writeFile("/okno/htdocs/" + rel, content);
    },
    async read(rel) {
      const b64 = Buffer.from("/okno/htdocs/" + rel, "utf8").toString("base64");
      const out = await php.runStream({ code: `<?php echo file_get_contents(base64_decode('${b64}'));` });
      return await out.stdoutText;
    },
    chmod() {
      /* MEMFS n'applique pas les permissions : voir blockDataDir() */
    },
    // MEMFS ignore chmod : on remplace le dossier data/ par un fichier, ce qui
    // produit le même effet (écriture impossible) côté PHP.
    async blockDataDir() {
      try {
        await php.rmdir("/okno/htdocs/data", { recursive: true });
        php.writeFile("/okno/htdocs/data", "pas un dossier");
        return true;
      } catch (e) {
        return false;
      }
    },
    async unblockDataDir() {
      try {
        await php.unlink("/okno/htdocs/data");
      } catch (e) {
        /* déjà retiré */
      }
      php.mkdirTree("/okno/htdocs/data");
      php.writeFile("/okno/htdocs/data/users.json", "[]\n");
      php.writeFile("/okno/htdocs/data/sessions.json", "{}\n");
    },
    close() {},
  };
}
