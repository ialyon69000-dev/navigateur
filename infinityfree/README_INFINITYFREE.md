# Portage InfinityFree — OKNO

## Réponse rapide
**Le projet Node.js ne peut PAS tourner tel quel sur InfinityFree gratuit.**
InfinityFree gratuit = Apache + PHP uniquement, pas de Node.js. D'où ce
portage 100% PHP dans `infinityfree/htdocs/`.

## Contenu de `infinityfree/htdocs/` (à mettre dans `htdocs/` du serveur)

```
index.php                                      PAGE DE MAINTENANCE (voir ci-dessous)
maintenance.css, maintenance.js                mise en forme + bascule RU/EN de cette page
styles.css, app.js, i18n.js                    frontend (drapeaux RU/EN, zone connexion)
confidentialite.html, contacts.html,
informations-juridiques.html, laboratoire.html pages statiques publiques (indexables)
auth/login.html, auth/register.html,
auth/dispatches.html, auth/auth.js             connexion / inscription / dépêches (noindex)
dashboard.html, dashboard.js                   tableau de bord (protégé par session, noindex)
dispatches.js                                  liste des dépêches
vk.html, log.php                               exercice de sensibilisation au phishing (noindex)
images/ru.svg, images/en.svg                   drapeaux du sélecteur de langue
seo-lib.php                                    fonctions SEO partagées (JSON-LD, pré-rendu)
robots.php, sitemap.php, llms.php              servis sous /robots.txt, /sitemap.xml, /llms.txt
.htaccess                                      réécritures /api/* + robots/sitemap/llms + en-têtes
api/
  _common.php          fonctions partagées (IP, geo ipwho.is, visits avec flock)
  me.php               GET  /api/me
  news.php             GET  /api/news — cache 5 min, décodage robuste
                       (UTF-8 toujours gagnant si valide, sinon windows-1251/koi8-r)
  visit.php            POST /api/visit
  visits.php           GET/DELETE /api/visits
  health.php           GET  /api/health
  dispatches.php       GET  /api/dispatches — la bande et ses sources
                       POST /api/dispatches, DELETE ?id= — rédaction seulement
  messages.php         GET  /api/messages   — messages vus dans dashboard.html
                       (?all=1 : brouillons, admin seul) ; POST / DELETE : admin
  comments.php         GET  /api/comments   — commentaires sous les messages ;
                       POST  : tout utilisateur connecté (lecteur ou éditeur) ;
                       DELETE ?id= : l'auteur, ou la rédaction (modération)
  _content.php         fonctions communes : sanitisation + contrôle des droits
  auth/
    _auth.php          logique commune (cookie okno-session, sha256+sel, sessions)
    challenge.php      GET  /api/auth/challenge — donne le sel du compte
    login.php          POST /api/auth/login (compteur anti-brute force)
    register.php       POST /api/auth/register
    me.php             GET  /api/auth/me
    logout.php         POST /api/auth/logout
data/
  users.json           comptes (seed : éditeur « okno »)
  sessions.json        sessions actives
  login_attempts.json  compteur d'échecs de connexion (anti-brute force)
  visits.json          journal des visites
  dispatches.json      dépêches de la bande (sources : visibles par la rédaction)
  messages.json        messages affichés par la rédaction dans le tableau de bord
  comments.json        commentaires des lecteurs et de la rédaction (messages)
  news_cache.json      dernier instantané propre des flux (UTF-8)
  .htaccess            interdit l'accès direct au dossier
```

## Page de maintenance (page d'accueil)

`index.php` est actuellement la page **« Технические работы »** — le portage PHP
de `public/index.html` (version Node). Les deux copies affichent la même chose,
avec les mêmes `maintenance.css` / `maintenance.js` : titre bilingue, sélecteur
RU/EN (drapeaux), manchette et statut de la rédaction.

Portée : **la page d'accueil seulement**. `/contacts.html`,
`/Legal-information.html`, `/confidentiality.html`, `/laboratoire.html`,
`/auth/*`, `/dashboard.html` et toute l'API `/api/*` restent servis normalement
— exactement comme sur la version Node.

Deux choses que la version PHP fait en plus de la copie statique :

- **la date et le numéro d'édition sont calculés côté serveur** (heure de
  Moscou, comme `app.js`) : la manchette reste juste sans JavaScript et ne
  vieillit pas si la maintenance dure ;
- **aucune lecture de `data/`, aucun appel à `seo-lib.php`** : la page
  s'affiche même si le cache des dépêches ou le dossier `data/` est en panne
  — c'est justement le cas où l'on coupe le site. Elle est aussi servie en
  `Cache-Control: no-store`, pour que le retour de l'édition soit immédiat.

**Signaler l'indisponibilité aux moteurs** : la page est en
`noindex, nofollow`. Si la maintenance dure plusieurs jours, préférer un vrai
code HTTP 503 — décommenter dans `index.php` :

```php
http_response_code(503);
header('Retry-After: 3600');
```

(À vérifier ensuite sur le serveur : certains hébergements gratuits remplacent
les réponses 5xx par leur propre écran d'erreur.)

**Revenir à l'édition normale** : `index.php` est versionné, donc

```bash
git log --oneline -- infinityfree/htdocs/index.php   # trouver la version « édition »
git checkout <commit> -- infinityfree/htdocs/index.php
```

puis renvoyer `index.php` sur le serveur (FTP ou workflow de déploiement).
`maintenance.css` / `maintenance.js` peuvent rester en place : plus rien ne les
appelle.

### Différences / limitations InfinityFree
1. **Cache** : pas de mémoire vive → `data/news_cache.json` avec TTL 5 min.
2. **Visites / comptes / sessions** : JSON sur disque avec `flock` (persistant).
3. **Géo IP** : ipwho.is via cURL ; si bloqué, `source: unavailable`, le site marche.
4. **Système de sécurité** : InfinityFree peut injecter un challenge JS sur les
   premières visites ; les fetch XHR même domaine passent ensuite.
5. **Limites** : 50k hits/jour, ~10% CPU, pas de cron. Le premier `/api/news`
   peut prendre ~8 s (téléchargement parallèle des 7 flux), puis cache 5 min.
6. **`data/` doit être inscriptible** : sinon l'ouverture de session échoue.
   Les écritures renvoient désormais HTTP 500 avec le correctif à appliquer, et
   `/api/health` indique `"dir":"readonly"`.
7. **`dashboard.html` reste une page statique** : sur InfinityFree il n'y a pas
   de serveur Node pour la protéger, c'est `dashboard.js` qui redirige vers la
   page de connexion si `/api/auth/me` répond « non connecté ». Les dépêches
   (`/api/dispatches`) restent donc lisibles sans session — en revanche **un
   lecteur n'affiche que les messages de la rédaction** : `dashboard.js` ne
   demande `/api/dispatches` que si `/api/auth/me` renvoie le rôle
   administrateur, et les écritures (`POST`/`DELETE`) sont refusées côté serveur
   (401 sans session, 403 pour un rôle `reader`) — la page seule ne fait pas la
   sécurité.

## Connexion : plus aucun mot de passe en clair

**Avant** : le navigateur envoyait `{"login": "...", "password": "..."}` — le mot
de passe en clair dans la requête. Pire, le gestionnaire de soumission n'était
jamais attaché (`$("#auth-form")` au lieu de `$("auth-form")` renvoyait `null`) :
le formulaire partait en GET natif et le mot de passe se retrouvait **dans la
barre d'adresse, l'historique et les journaux du serveur**, sans jamais
connecter personne.

**Maintenant** :

1. `GET /api/auth/challenge?login=x` → le serveur renvoie le **sel** du compte
   (sel de substitution pour un login inconnu : pas d'énumération de comptes).
2. Le navigateur calcule `H1 = sha256(mot_de_passe + sel)` — Web Crypto, ou une
   implémentation SHA-256 en JS pur si la page est servie en `http://` simple
   (`crypto.subtle` n'existe pas hors contexte sécurisé, cas fréquent sur un
   hébergement gratuit sans certificat).
3. `POST /api/auth/login {login, hash}` — **le mot de passe ne quitte jamais le
   navigateur**. Le serveur stocke `H2 = sha256(H1 + sel)`.
4. Le serveur **refuse** tout corps contenant un champ `password` (HTTP 400) :
   une vieille copie de `auth.js` en cache provoque un message explicite
   « mettez la page à jour » au lieu d'un envoi en clair.

Les comptes créés avant (schéma 1 : `hash = sha256(mot_de_passe + sel)`) sont
**migrés automatiquement** au premier login réussi, sans jamais recevoir le mot
de passe en clair — le navigateur calcule lui-même l'ancien hash.

Cinq échecs d'affilée pour le même couple IP + login bloquent les tentatives
suivantes (HTTP 429) pendant 15 minutes ; une connexion réussie remet le
compteur à zéro (`data/login_attempts.json`).

Garde-fous côté page : le formulaire est en `method="post"` et son
`onsubmit="return window.OKNO_AUTH_READY === true"` bloque tout envoi natif si
le script n'a pas démarré. Enfin, si le `.htaccess` n'a pas été remis à jour,
`auth.js` retombe tout seul sur les URL `.php` (`/api/auth/login.php` …).

### Fichiers à renvoyer sur le serveur après une mise à jour

Schéma de connexion (hash côté navigateur) :

```
auth/auth.js            (nouvelle logique de hachage)
auth/login.html         (method="post" + garde-fou + auth.js?v=2)
auth/register.html      (idem)
api/auth/_auth.php      (schéma 2, erreurs d'écriture explicites)
api/auth/challenge.php  (NOUVEAU)
api/auth/login.php      (vérification du hash + migration)
api/auth/register.php   (sel fourni par le navigateur)
api/health.php          (diagnostic data/)
.htaccess               (réécriture /api/auth/challenge)
```

Page de maintenance :

```
index.php                                   (page « Технические работы »)
maintenance.css, maintenance.js             (NOUVEAU — mise en forme + bascule RU/EN)
```

Rôles traduits + messages de la rédaction dans le tableau de bord :

```
i18n.js, dashboard.js, dashboard.html       (rôles traduits, sections admin)
dispatches.js, auth/dispatches.html         (rôle traduit sur la page publique)
api/messages.php, api/_content.php          (NOUVEAU — droits + sanitisation)
api/dispatches.php                          (POST/DELETE en plus du GET)
api/auth/_auth.php                          (/api/auth/me renvoie createdAt)
data/messages.json                          (NOUVEAU — messages bilingues ru/en)
.htaccess                                   (réécriture /api/messages)
```

⚠️ `data/` n'est **pas** renvoyé par le déploiement automatique (pour préserver
les données du serveur) : pour un premier déploiement, cocher `include_data`, ou
éditer le fichier à la main dans le File Manager. Côté PHP, `data/messages.json`
est créé à la première écriture si le dossier est inscriptible.

Puis **Ctrl+F5** dans le navigateur : le `.htaccess` met le JS en cache 1 h.

### Diagnostiquer en 10 secondes

`https://tondomaine/api/health` doit renvoyer :

```json
{"ok":true,"php":"8.2.x","data":{"dir":"writable","hint":null,"accounts":1}}
```

- `"dir":"readonly"` → **c'est la panne classique** : le serveur ne peut pas
  écrire `data/sessions.json`, la connexion « réussit » puis renvoie sur la page
  de login. Corriger : `chmod 777 data/` et `chmod 666 data/*.json`.
- Une page HTML à la place du JSON → les `.php` ne sont pas exécutés
  (réécritures `.htaccess` absentes, ou fichiers non envoyés).

### Mot de passe perdu / compte admin

Le compte seed `okno` de `data/users.json` n'a pas de mot de passe documenté
dans le dépôt. Pour en fixer un (ou créer un compte éditeur) :

```bash
node scripts/auth-user.mjs okno "MonMotDePasse" --role editor --id admin
```

Copier l'objet affiché dans `data/users.json` (version Node) et/ou
`infinityfree/htdocs/data/users.json` (version PHP, via le File Manager
InfinityFree). Sinon, la page `/auth/register.html` crée un compte « reader ».

## Tests

```bash
npm test
```

- `tests/sha256.test.mjs` — le SHA-256 JS de repli == le SHA-256 de Node/OpenSSL
  (UTF-8, cyrillique, emoji, toutes les longueurs de padding).
- `tests/auth-form.test.mjs` — le vrai `auth.js` dans un DOM minimal : le
  gestionnaire est attaché, la soumission native est annulée, le corps envoyé ne
  contient que `{login, hash}` (jamais le mot de passe), repli `.php`, messages
  d'erreur affichés.
- `tests/php-api.test.mjs` — l'API PHP de bout en bout (health, challenge,
  inscription, connexion + cookie, session, déconnexion, migration schéma 1 → 2,
  refus du mot de passe en clair, `data/` non inscriptible). Utilise le binaire
  `php` s'il est installé, sinon `@php-wasm/node` s'il est disponible.
- `tests/node-api.test.mjs` — le même protocole contre `server.js`.
- `tests/maintenance-page.test.mjs` — les deux pages de maintenance
  (`public/index.html` et `infinityfree/htdocs/index.php`) disent mot pour mot
  la même chose, chargent bien `maintenance.css`/`maintenance.js` (identiques
  des deux côtés), et la version PHP ne lit ni `data/` ni le cache SEO.

## Déploiement — tout d'un coup via GitHub Actions (recommandé)

Le workflow `.github/workflows/deploy-infinityfree.yml` envoie tout le dossier
`infinityfree/htdocs/` vers `/htdocs/` par FTP.

1. **Secrets** : GitHub → Settings → Secrets and variables → Actions :
   - `FTP_SERVER` = `ftpupload.net` (ou le serveur indiqué par InfinityFree)
   - `FTP_USERNAME` = identifiant du compte FTP (ex. `if0_12345678`)
   - `FTP_PASSWORD` = mot de passe FTP
2. **Première installation** : onglet Actions → « Deploy PHP to InfinityFree »
   → Run workflow → **cocher `include_data`** (envoie aussi `data/`).
3. **Ensuite** : chaque push sur `main` qui modifie `infinityfree/htdocs/`
   redéploie le code automatiquement, **sans écraser `data/`** du serveur
   (visites, comptes, sessions et cache accumulés sont préservés).
4. Droits : dans le File Manager InfinityFree, chmod **777** sur `data/` et
   **666** sur les fichiers `data/*.json` (nécessaire pour l'écriture).
5. Tests : `https://tondomaine/api/health` → `{"ok":true}`, puis
   `https://tondomaine/api/news` → JSON avec `items` non vide.

## Déploiement manuel (FileZilla ou File Manager)

1. Upload du **contenu** de `infinityfree/htdocs/` dans `htdocs/` (pas le dossier).
2. chmod 777 `data/`, 666 `data/*.json`.
3. PHP 8.1/8.2 recommandé.
4. Test `/api/health`.

## Rafraîchir le cache de nouvelles sans attendre

Workflow « Refresh OKNO news cache » (`workflow_dispatch`) : régénère
`infinityfree/htdocs/data/news_cache.json` depuis les 7 flux RSS avec le même
décodage robuste, et le committe sur la branche. Sur InfinityFree, le cache se
régénère aussi tout seul toutes les 5 min en arrière-plan.

## Référencement : moteurs de recherche et LLM

La home était en `noindex` et ses dépêches 100 % rendues en JavaScript :
les robots (dont les aspirateurs de grands modèles de langage) ne voyaient
qu'une page vide. Optimisations apportées :

> ⚠️ **Pendant la maintenance**, la home est la page « Технические работы » :
> elle est volontairement en `noindex` et ne pré-rend plus de dépêches. Les
> points ci-dessous décrivent l'état à rétablir quand l'édition revient (voir
> « Page de maintenance » plus haut) ; `/robots.txt`, `/sitemap.xml` et
> `/llms.txt` continuent, eux, de fonctionner.

- **`index.php` remplace `index.html`** (`.htaccess` met `DirectoryIndex index.php`) :
  le serveur **pré-rend les dépêches** dans le HTML (il lit `data/news_cache.json`),
  avec un `<h1>` et une balise `<article>` par dépêche. Les robots et les LLM
  reçoivent donc tout le texte ; `app.js` remplace ensuite ce bloc par l'édition
  mise en forme dès qu'il a chargé `/api/news`.
- **JSON-LD** (`schema.org`) sur la home : `NewsMediaOrganization` + `WebSite`
  (avec `SearchAction`) + `ItemList` de `NewsArticle` (titre, source, date, image).
- **`/robots.txt`** (généré par `robots.php`) : autorise les pages publiques,
  interdit `auth/`, `dashboard`, `data/`, `api/`, l'exercice phishing, et
  **autorise explicitement les aspirateurs LLM/IA** (GPTBot, OAI-SearchBot,
  ClaudeBot, PerplexityBot, Google-Extended, CCBot, Amazonbot, Bytespider…).
- **`/sitemap.xml`** (généré par `sitemap.php`) : liste des pages publiques avec
  `lastmod` (fraîcheur du cache de dépêches pour la home).
- **`/llms.txt`** (généré par `llms.php` ; `?full=1` ajoute les titres des
  dernières dépêches) : résumé en Markdown clair du site, dédié aux LLM.
- **Méta** : `robots: index, follow`, `description`, `canonical`, Open Graph et
  Twitter Card sur la home et les pages publiques. Restent en `noindex` :
  login, register, dashboard, dispatches, et l'exercice `vk.html`.

Les URL absolues des `canonical` / `sitemap` / `llms.txt` sont calculées depuis
la requête (`seo_base_url()`) : elles sont correctes quel que soit le domaine.
En local (`php -S`) le `.htaccess` ne réécrit pas — appeler directement
`/robots.php`, `/sitemap.php`, `/llms.php`.

## Test en local

```bash
cd infinityfree/htdocs
php -S localhost:8000
# http://localhost:8000/                 → index.php (page de maintenance RU/EN)
# http://localhost:8000/robots.php       → robots.txt (en local, /robots.txt ne marche pas)
# http://localhost:8000/sitemap.php      → sitemap.xml
# http://localhost:8000/llms.php         → llms.txt (?full=1 avec les dépêches)
# http://localhost:8000/api/health
# http://localhost:8000/auth/login.html
```

Le serveur intégré de PHP n'applique pas le `.htaccess` : les URL propres
(`/api/auth/login`) y renvoient 404. Ce n'est pas grave, `auth.js` retombe
automatiquement sur `/api/auth/login.php`.
