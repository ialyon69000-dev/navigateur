# OKNO — Revue internationale (Node + PHP)

Projet pédagogique : unes des médias russes + démonstration empreinte navigateur.

## Deux versions

### 1. Version Node.js (originale) - `server.js` + `public/`
- Express + rss-parser + iconv-lite
- APIs : `/api/me`, `/api/news`, `/api/visit`, `/api/visits`, `/api/health`
- Stockage `data/visits.json` (MAX 800) et `data/news_cache.json` (rafraîchi toutes les 5 min)
- `render.yaml` prêt pour Render.com
- Mais FS éphémère sur Render free → `visits.json` perdue

**Lancer :**
```bash
npm install
npm start # http://localhost:3000
```

### 2. Version PHP pour hébergement gratuit - `php/` **← pour InfinityFree**
Portage complet 100% PHP, **fichier JSON permanent** sur disque.

Prête pour :
- InfinityFree (ftpupload.net)
- 000webhost, Hostinger Free, AlwaysData, PlanetHoster Free

**Contenu `php/` = ce qu'il faut mettre dans `htdocs/` :**
```
php/index.html, styles.css, app.js
php/.htaccess
php/api/*.php
php/data/visits.json (writable 666)
```

**Lancer en local :**
```bash
cd php
php -S localhost:8000
```

**Deploy InfinityFree :**
1. Upload `php/*` → `htdocs/` via FTP/FileManager
2. chmod 777 `data/`, 666 `visits.json` + `news_cache.json`
3. Test `/api/health`

**Deploy auto GitHub → InfinityFree :**
- Ajoute secrets `FTP_SERVER=ftpupload.net`, `FTP_USERNAME`, `FTP_PASSWORD`
- Push sur `main` → workflow `.github/workflows/deploy-php.yml` upload `php/` → `/htdocs/`

## Autres deploys dispo

- `deploy/oracle/` : guide + scripts pour Oracle Always Free VM (Node permanent, vrai disque, gratuit à vie) - recommandé si tu veux garder Node tel quel avec JSON permanent
- `infinityfree/` : ancienne version du portage (identique à `php/`)
- `fly.toml` + `Dockerfile` : Fly.io / Northflank / Koyeb avec volume persistant

## Choix rapide

| Besoin | Solution |
|--------|----------|
| Gratuit PHP + JSON permanent | `php/` → InfinityFree |
| Gratuit Node + JSON permanent | Oracle VM (`deploy/oracle/`) ou Northflank Sandbox |
| Gratuit Node mais JSON éphémère | Render free (actuel `render.yaml`) |

Voir `php/README.md` et `deploy/oracle/README.md` pour détails complets.
