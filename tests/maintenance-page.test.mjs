/**
 * La page de maintenance existe en DEUX exemplaires, comme le reste du site :
 *
 *   public/index.html              → version Node (server.js sert public/)
 *   infinityfree/htdocs/index.php  → version PHP (hébergement gratuit)
 *
 * Le risque, sur un dépôt à deux copies, c'est qu'une seule soit mise à jour :
 * on vérifie donc que les deux disent exactement la même chose (mêmes textes
 * RU/EN, mêmes fichiers liés) et que les ressources appelées existent bien des
 * deux côtés — sinon la page de maintenance s'afficherait sans sa mise en
 * forme, précisément le jour où le site est coupé.
 *
 * Même esprit que sha256.test.mjs (« les deux copies de auth.js sont
 * identiques ») et auth-form.test.mjs (garde-fous lus dans le HTML).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./helpers/load-auth.mjs";

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

const NODE_PAGE = "public/index.html";
const PHP_PAGE = "infinityfree/htdocs/index.php";

/** Les couples de traductions de la page, dans l'ordre d'apparition. */
const pairs = (html) =>
  [...html.matchAll(/data-ru="([^"]*)"\s+data-en="([^"]*)"/g)].map((m) => ({ ru: m[1], en: m[2] }));

/**
 * Le code PHP sans ses commentaires : on veut interdire des *appels*
 * (`require seo-lib.php`…), pas le droit d'en parler dans l'en-tête du fichier.
 */
const phpCode = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

test("les ressources de la page de maintenance sont dans les deux copies", () => {
  for (const asset of ["maintenance.css", "maintenance.js"]) {
    const a = read(`public/${asset}`);
    const b = read(`infinityfree/htdocs/${asset}`);
    assert.equal(a, b, `${asset} : les deux copies doivent être identiques`);
  }
});

test("les deux pages d’accueil sont bien la page de maintenance", () => {
  for (const rel of [NODE_PAGE, PHP_PAGE]) {
    const src = read(rel);
    assert.match(src, /<body class="maintenance-page">/, rel);
    assert.match(src, /<link rel="stylesheet" href="\/maintenance\.css" \/>/, rel);
    assert.match(src, /<script src="\/maintenance\.js"><\/script>/, rel);
    // La maintenance ne doit pas être indexée…
    assert.match(src, /<meta name="robots" content="noindex, nofollow" \/>/, rel);
    // …ni continuer à charger l'édition (dépêches, i18n, JSON-LD, ticker).
    assert.doesNotMatch(src, /src="\/app\.js"/, `${rel} : l'édition ne doit plus être chargée`);
    assert.doesNotMatch(src, /src="\/i18n\.js"/, `${rel} : i18n.js est remplacé par maintenance.js`);
    assert.doesNotMatch(src, /id="news-root"/, `${rel} : plus de conteneur de dépêches`);
  }
});

test("la version PHP dit mot pour mot la même chose que la version Node", () => {
  const nodePairs = pairs(read(NODE_PAGE));
  const phpPairs = pairs(read(PHP_PAGE));
  assert.ok(nodePairs.length >= 10, "la page traduit bien tout son contenu");
  assert.deepEqual(phpPairs, nodePairs, "textes RU/EN identiques, dans le même ordre");
});

test("la version PHP calcule sa date côté serveur (heure de Moscou)", () => {
  const src = read(PHP_PAGE);
  // La copie statique porte une date figée dans le HTML : sur InfinityFree on
  // a PHP, donc la manchette doit rester juste même sans JavaScript et même
  // si la maintenance se prolonge.
  assert.match(src, /new DateTimeZone\('Europe\/Moscow'\)/, "même fuseau que app.js");
  assert.match(src, /<time id="today" datetime="<\?php echo \$dateIso; \?>">/);
  assert.doesNotMatch(src, /datetime="20\d\d-\d\d-\d\d"/, "aucune date figée en dur");
});

test("la page de maintenance PHP ne dépend ni de data/ ni du SEO des dépêches", () => {
  // Si l'on coupe le site, c'est souvent que data/ ou le cache est en panne :
  // la page doit s'afficher sans rien lire de tout cela.
  const code = phpCode(read(PHP_PAGE));
  assert.doesNotMatch(code, /require.*seo-lib\.php/, "pas d'inclusion de la bibliothèque SEO");
  assert.doesNotMatch(code, /seo_news_items|seo_news_html|seo_home_jsonld/, "aucune lecture des dépêches");
  assert.doesNotMatch(code, /news_cache\.json/, "aucune lecture du cache");
  assert.doesNotMatch(code, /file_get_contents|fopen|json_decode/, "aucune lecture de fichier");
  assert.match(code, /Cache-Control: no-store/, "la page ne doit pas rester en cache");
});
