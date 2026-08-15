# OKNO — Version PHP pour hébergement gratuit

Version **100% PHP** du projet `ialyon69000-dev/navigateur` (à l'origine Node.js/Express). Prête à être poussée sur **InfinityFree, 000webhost, Hostinger Free, PlanetHoster Free, AlwaysData Free**, etc.

**Fichier JSON permanent** : `data/visits.json` est un vrai fichier sur le disque, pas éphémère (contrairement à Render free). Sur InfinityFree il survit aux déploiements.

---

## Arborescence (à mettre dans `htdocs/`)

```
index.html, styles.css, app.js (frontend)
.htaccess -> rewrite /api/me, /api/news, etc. vers api/*.php
api/
  _common.php    # IP, geo ipwho.is, read/write visits avec flock
  me.php         # GET /api/me
  news.php       # GET /api/news - cache 5min fichier, gestion win1251->utf8
  visit.php      # POST /api/visit
  visits.php     # GET /api/visits, DELETE
  health.php     # GET /api/health
data/
  visits.json         # doit être writable 666/777
  news_cache.json     # cache RSS, writable
  .htaccess           # Deny all
```

Frontend `app.js` inchangé : appelle `/api/me`, `/api/news`, `/api/visit`.

---

## Déploiement InfinityFree (gratuit)

1. Crée compte https://infinityfree.com → crée domaine → note :
   - FTP Host : `ftpupload.net`
   - Username : `if0_xxxxxx`
   - Password : dans Client Area
   - Domain : `ton-site.infinityfreeapp.com`

2. **Upload manuel :**
   - FileZilla ou File Manager InfinityFree
   - Upload tout le contenu de `php/` dans `htdocs/` (pas le dossier php lui-même)

3. **Permissions :**
   - File Manager > `htdocs/data/` > droits 777 sur dossier, 666 sur `visits.json` et `news_cache.json`
   - Si erreur 403 : `data/.htaccess` doit rester `Require all denied` (protège mais permet PHP à lire)

4. Test :
   - `https://ton-site.infinityfreeapp.com/api/health` → `{"ok":true}`
   - `https://ton-site.infinityfreeapp.com/api/news` → JSON 120 items

5. **Auto-deploy GitHub → InfinityFree :**
   - Dans ton repo GitHub > Settings > Secrets > ajoute :
     - `FTP_SERVER` = `ftpupload.net`
     - `FTP_USERNAME` = `if0_xxxxxx`
     - `FTP_PASSWORD` = ton pass
   - Push sur `main` déclenche `.github/workflows/deploy-php.yml` qui upload `php/` vers `/htdocs`

---

## Déploiement 000webhost / Hostinger Free / AlwaysData

Même principe : upload `php/*` dans `public_html/` ou `www/` selon host.

- Hostinger : hPanel > File Manager > `public_html` > Upload
- AlwaysData : `www/` + active PHP 8.2 dans admin
- PlanetHoster Free : idem

Assure-toi que l'extension `curl`, `mbstring`, `iconv` est active (active par défaut).

---

## Fonctionnalités portées depuis Node

- Sécurisation `clampStr`, `sanitizeVisit` identique au Node
- `clientIp()` : CF-Connecting-IP, X-Forwarded-For, X-Real-IP
- `geoFromIp()` : appel `https://ipwho.is/` avec timeout 5s, fallback local
- RSS : 7 flux (TASS, RIA, Lenta, Kommersant, Izvestia, MK, Gazeta), mêmes couleurs
  - Détection charset header + `encoding=""` XML, conversion win1251→UTF-8 via `iconv`/`mb_convert_encoding`
  - `looksBrokenCyrillic` pour forcer conversion si besoin
  - parse `enclosure`, `media:content`, `media:thumbnail`, img dans description, `guessImage` RIA/Kommersant
  - tri date, dédup titre 80 chars, équilibrage 12/source, 120 max
  - cache fichier 5min `news_cache.json`

---

## Développement local

```bash
cd php
php -S localhost:8000
# ou si tu as php 8.2+
php -S 0.0.0.0:8000 -t .
# Teste : http://localhost:8000/api/news?refresh=1
```

---

## Pourquoi cette version ?

Ton projet Node ne peut **pas** tourner sur InfinityFree gratuit : "InfinityFree doesn't support Node.js, only PHP" [voir forum]. Cette version PHP garde 100% des features + fichier JSON permanent car FS PHP sur InfinityFree est persistant (contrairement à Render free éphémère).

---

## Licence & crédits

Portage pédagogique du projet original `empreinte` par @ialyon69000-dev.
