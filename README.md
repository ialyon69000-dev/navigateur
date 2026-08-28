# OKNO — Revue internationale (Node + PHP)

Projet pédagogique : unes des médias russes + démonstration empreinte navigateur.

## Connexion (identique dans les deux versions)

Le mot de passe **ne quitte jamais le navigateur** :

1. `GET /api/auth/challenge?login=x` → le serveur donne le sel du compte ;
2. le navigateur envoie `sha256(mot_de_passe + sel)` (Web Crypto, ou SHA-256 en
   JS pur si la page est en `http://` simple) ;
3. le serveur stocke `sha256( sha256(mot_de_passe + sel) + sel )` et pose un
   cookie de session `okno-session` (HttpOnly, SameSite=Lax).

Un corps de requête contenant un champ `password` est refusé (HTTP 400) et les
comptes de l'ancien schéma sont migrés au premier login. Réinitialiser un mot de
passe : `node scripts/auth-user.mjs <login> <mot_de_passe> --role editor`.

```bash
npm test   # sha256 de repli, auth.js, API PHP de bout en bout, API Node
```

## Deux versions

### 1. Version Node.js (originale) — `server.js` + `public/`
- Express + rss-parser + iconv-lite
- APIs : `/api/me`, `/api/news`, `/api/visit`, `/api/visits`, `/api/health`
- Authentification : `/api/auth/login|register|me|logout`, tableau de bord `/dashboard.html`
- Stockage `data/` (visits.json, users.json, sessions.json, dispatches.json, news_cache.json)
- `render.yaml` prêt pour Render.com

**Lancer :**
```bash
npm install
npm start   # http://localhost:3000
```

### 2. Version PHP pour hébergement gratuit — `infinityfree/htdocs/` **← pour InfinityFree**
Portage complet 100% PHP, **fichiers JSON permanents** sur disque. Mêmes
fonctionnalités que la version Node : drapeaux RU/EN, zone de connexion,
encodage robuste des flux RSS (UTF-8/windows-1251/koi8-r).

Prête pour :
- InfinityFree (ftpupload.net)
- 000webhost, Hostinger Free, AlwaysData, PlanetHoster Free

**Contenu `infinityfree/htdocs/` = ce qu'il faut mettre dans `htdocs/` :**
```
index.html, styles.css, app.js, i18n.js            (frontend)
confidentialite/contacts/informations-juridiques/laboratoire.html
auth/login.html, auth/register.html, auth/dispatches.html, dashboard.html
vk.html + log.php                                   (exercice phishing)
.htaccess                                           (réécritures /api/*)
api/*.php + api/auth/*.php                          (backend)
data/*.json                                         (writable : 777 data/, 666 fichiers)
```

**Lancer en local :**
```bash
cd infinityfree/htdocs
php -S localhost:8000
```

**Deploy InfinityFree — tout d'un coup via GitHub Actions :**
1. GitHub → Settings → Secrets and variables → Actions, ajouter :
   `FTP_SERVER=ftpupload.net`, `FTP_USERNAME`, `FTP_PASSWORD`
2. Première installation : Actions → « Deploy PHP to InfinityFree » →
   Run workflow → cocher `include_data` (envoie aussi `data/`)
3. Ensuite chaque push sur `main` (modifs dans `infinityfree/htdocs/`)
   redéploie le code automatiquement **sans écraser `data/`** du serveur.

**Deploy manuel (FileZilla/FileManager) :**
1. Upload `infinityfree/htdocs/*` → `htdocs/`
2. chmod 777 `data/`, 666 les fichiers `data/*.json`
3. Test `/api/health`

## Autres déploiements

- `fly.toml` + `Dockerfile` : Fly.io / Northflank / Koyeb avec volume persistant
- `scripts/refresh-news-cache.js` + workflow « Refresh OKNO news cache » :
  régénère `infinityfree/htdocs/data/news_cache.json` (déploiement PHP)

## Choix rapide

| Besoin | Solution |
|--------|----------|
| Gratuit PHP + JSON permanent | `infinityfree/htdocs/` → InfinityFree |
| Gratuit Node mais JSON éphémère | Render free (actuel `render.yaml`) |
| Node + volume persistant | Fly.io (`fly.toml` + volume) |

Voir `infinityfree/README_INFINITYFREE.md` pour les détails complets.
