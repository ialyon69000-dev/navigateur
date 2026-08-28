# Portage InfinityFree — OKNO

## Réponse rapide
**Le projet Node.js ne peut PAS tourner tel quel sur InfinityFree gratuit.**
InfinityFree gratuit = Apache + PHP uniquement, pas de Node.js. D'où ce
portage 100% PHP dans `infinityfree/htdocs/`.

## Contenu de `infinityfree/htdocs/` (à mettre dans `htdocs/` du serveur)

```
index.html, styles.css, app.js, i18n.js        frontend (drapeaux RU/EN, zone connexion)
confidentialite.html, contacts.html,
informations-juridiques.html, laboratoire.html pages statiques
auth/login.html, auth/register.html,
auth/dispatches.html, auth/auth.js             connexion / inscription / dépêches
dashboard.html, dashboard.js                   tableau de bord (protégé par session)
dispatches.js                                  liste des dépêches
vk.html, log.php                               exercice de sensibilisation au phishing
images/ru.svg, images/en.svg                   drapeaux du sélecteur de langue
.htaccess                                      réécritures /api/* + en-têtes sécurité
api/
  _common.php          fonctions partagées (IP, geo ipwho.is, visits avec flock)
  me.php               GET  /api/me
  news.php             GET  /api/news — cache 5 min, décodage robuste
                       (UTF-8 toujours gagnant si valide, sinon windows-1251/koi8-r)
  visit.php            POST /api/visit
  visits.php           GET/DELETE /api/visits
  health.php           GET  /api/health
  dispatches.php       GET  /api/dispatches
  auth/
    _auth.php          logique commune (cookie okno-session, sha256+sel, sessions)
    challenge.php      GET  /api/auth/challenge — donne le sel du compte
    login.php          POST /api/auth/login
    register.php       POST /api/auth/register
    me.php             GET  /api/auth/me
    logout.php         POST /api/auth/logout
data/
  users.json           comptes (seed : éditeur « okno »)
  sessions.json        sessions actives
  visits.json          journal des visites
  dispatches.json      dépêches du tableau de bord
  news_cache.json      dernier instantané propre des flux (UTF-8)
  .htaccess            interdit l'accès direct au dossier
```

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
   (`/api/dispatches`) restent donc lisibles sans session.

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

Garde-fous côté page : le formulaire est en `method="post"` et son
`onsubmit="return window.OKNO_AUTH_READY === true"` bloque tout envoi natif si
le script n'a pas démarré. Enfin, si le `.htaccess` n'a pas été remis à jour,
`auth.js` retombe tout seul sur les URL `.php` (`/api/auth/login.php` …).

### Fichiers à renvoyer sur le serveur après cette mise à jour

```
auth/auth.js            (nouvelle logique de hachage)
auth/login.html         (method="post" + garde-fou + auth.js?v=2)
auth/register.html      (idem)
i18n.js                 (2 nouveaux messages)
api/auth/_auth.php      (schéma 2, erreurs d'écriture explicites)
api/auth/challenge.php  (NOUVEAU)
api/auth/login.php      (vérification du hash + migration)
api/auth/register.php   (sel fourni par le navigateur)
api/health.php          (diagnostic data/)
.htaccess               (réécriture /api/auth/challenge)
```

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

## Test en local

```bash
cd infinityfree/htdocs
php -S localhost:8000
# http://localhost:8000/api/health
# http://localhost:8000/auth/login.html
```

Le serveur intégré de PHP n'applique pas le `.htaccess` : les URL propres
(`/api/auth/login`) y renvoient 404. Ce n'est pas grave, `auth.js` retombe
automatiquement sur `/api/auth/login.php`.
