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
```
