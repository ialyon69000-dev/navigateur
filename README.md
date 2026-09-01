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
npm test   # sha256 de repli, auth.js, API PHP de bout en bout, API Node, tableau de bord
```

## Rôles et contenu éditorial (identiques dans les deux versions)

Deux rôles seulement, et **le libellé n'est jamais renvoyé par le serveur** :
l'interface traduit `reader` / `editor` via le dictionnaire RU/EN
(`OKNO.roleLabel`, voir `public/i18n.js`) — un `admin` est toléré dans
`data/users.json` et affiche « Администратор / Administrator ».

| Rôle | Ce qu'il gère | Ce qu'il voit dans `/dashboard.html` |
|------|---------------|--------------------------------------|
| `editor` (= admin du projet) | la bande (les flux **et leurs sources**) **et** les messages affichés aux utilisateurs | messages + « Publications des messages » + « La bande et ses sources » |
| `reader` | rien | **uniquement** les messages publiés par la rédaction |

Un lecteur ne reçoit donc jamais la source d'un flux : `dashboard.js` n'appelle
`/api/dispatches` que si le rôle est administrateur, et le tableau reste vide
dans la page servie.

Écrire (messages ou bande) exige une session valide + un rôle administrateur :

| Route | Effet | Droits |
|-------|-------|--------|
| `GET /api/messages` | messages publiés ; `?all=1` ajoute les brouillons (admin seulement) | public |
| `POST /api/messages` | créer (sans `id`) ou mettre à jour (avec `id`) ; un envoi partiel ne vide pas les autres champs | admin |
| `DELETE /api/messages?id=…` | retirer un message | admin |
| `GET /api/dispatches` | la bande, sources comprises | public |
| `POST /api/dispatches` / `DELETE /api/dispatches?id=…` | ajouter / corriger / retirer une dépêche | admin |

Un message est bilingue : `{ title: { ru, en }, body: { ru, en }, active }`.
L'utilisateur lit la langue qu'il a choisie (repli sur le russe si la version
manque). Les brouillons (`active: false`) ne quittent jamais le serveur.
Stockage : `data/messages.json` et `data/dispatches.json` (mêmes fichiers côté PHP).

## Synthèse des visiteurs (`data/visits.json`)

`visits.json` n'est plus un simple tableau : le fichier porte désormais la
synthèse des clients qui consultent le site, recalculée à chaque écriture à
partir des **seules** données déjà envoyées par le navigateur (aucune collecte
supplémentaire, aucun cookie de suivi).

```jsonc
{
  "generatedAt": "2026-09-01T20:19:42.700Z",
  "summary": {                 // vue d'ensemble
    "totalVisits": 42, "uniqueClients": 17,
    "returningClients": 6, "newClients": 11,
    "returningRate": 0.353, "visitsPerClient": 2.47, "activeDays": 5,
    "firstVisitAt": "…", "lastVisitAt": "…",
    "gpsShared": 1, "automated": 0,
    "topCountries": [{ "value": "Russia", "count": 9 }],
    "topCities": [], "topDevices": [], "topBrowsers": [], "topSystems": [],
    "topLanguages": [], "topTimezones": [], "topReferrers": [],
    "visitsByHourUTC": [{ "value": "20h", "count": 4 }]
  },
  "clients": [                 // une fiche par visiteur
    {
      "clientId": "c_33baca6a20fcf988",
      "visits": 3, "distinctDays": 2, "returning": true,
      "firstSeen": "…", "lastSeen": "…", "daysBetweenFirstAndLast": 1.2,
      "ip": "203.0.113.4",
      "place": { "city": "Moscow", "region": "…", "country": "Russia", "isp": "…" },
      "device": { "type": "desktop", "os": "Windows 10/11", "browser": "Chrome 120",
                  "screen": "1920×1080", "gpu": "…", "cores": 8, "memoryGB": 8, "touch": false },
      "preferences": { "language": "ru", "timezone": "Europe/Moscow",
                       "colorScheme": "dark", "keyboardLayout": "…" },
      "network": { "effectiveType": "4g", "downlink": 10, "rtt": 50 },
      "privacy": { "cookiesEnabled": true, "globalPrivacyControl": false,
                   "consent": true, "automated": false },
      "referrers": [{ "value": "https://ya.ru/", "count": 2 }],
      "gpsShared": false,
      "visitIds": ["v_…"]
    }
  ],
  "visits": [ /* le journal brut, inchangé */ ]
}
```

Le regroupement s'appuie sur une **empreinte stable recalculée** (IP, système,
navigateur, type d'appareil, écran, langue, fuseau, GPU, cœurs, mémoire) hachée
en `c_…` : deux passages du même poste comptent pour un seul client, sans
identifiant persistant déposé chez l'internaute.

Compatibilité : un ancien `visits.json` (tableau brut) est toujours lu, et la
synthèse est reconstruite à la première écriture.

| Route | Effet |
|-------|-------|
| `GET /api/visits` | journal + `summary` + `clients` |
| `GET /api/visits/summary` (PHP : `api/visits.php?summary=1`) | synthèse seule, sans le journal |
| `POST /api/visit` | enregistre la visite et renvoie la `summary` à jour |
| `DELETE /api/visits` | vide le journal et remet la synthèse à zéro |

La page **Лаборатория / Laboratory** affiche cette synthèse : cartes de
totaux, classements (pays, appareils, navigateurs, systèmes, langues,
référents) et un tableau des clients.

## Deux versions

### 1. Version Node.js (originale) — `server.js` + `public/`
- Express + rss-parser + iconv-lite
- APIs : `/api/me`, `/api/news`, `/api/visit`, `/api/visits`, `/api/health`,
  `/api/messages`, `/api/dispatches` (lecture + écriture admin)
- Authentification : `/api/auth/login|register|me|logout`, tableau de bord `/dashboard.html`
- Stockage `data/` (visits.json, users.json, sessions.json, dispatches.json, messages.json, news_cache.json)
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
api/*.php + api/auth/*.php                          (backend, dont messages.php et _content.php)
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
