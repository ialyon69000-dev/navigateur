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

Cinq échecs d'affilée pour le même couple IP + login bloquent les tentatives
suivantes (HTTP 429) pendant 15 minutes ; une connexion réussie remet le
compteur à zéro.

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

Écrire (messages ou bande) exige une session valide + un rôle administrateur.
En revanche **commenter est ouvert à tout utilisateur connecté** — lecteur
comme éditeur : chacun écrit sous les messages publiés par la rédaction, avec
son login de session (jamais une valeur du client), et peut retirer son propre
commentaire ; la rédaction modère l'ensemble.

| Route | Effet | Droits |
|-------|-------|--------|
| `GET /api/messages` | messages publiés ; `?all=1` ajoute les brouillons (admin seulement) | public |
| `POST /api/messages` | créer (sans `id`) ou mettre à jour (avec `id`) ; un envoi partiel ne vide pas les autres champs | admin |
| `DELETE /api/messages?id=…` | retirer un message (ses commentaires sont emportés) | admin |
| `GET /api/comments` | commentaires des messages visibles ; `?messageId=…` pour un seul ; la rédaction voit aussi ceux de ses brouillons | public |
| `POST /api/comments` | commenter un message (`{ messageId, body }`, auteur = login de session) ; un lecteur ne commente que les messages publiés | session valide |
| `DELETE /api/comments?id=…` | retirer son propre commentaire (la rédaction retire n'importe lequel) | auteur ou admin |
| `GET /api/dispatches` | la bande, sources comprises | public |
| `POST /api/dispatches` / `DELETE /api/dispatches?id=…` | ajouter / corriger / retirer une dépêche | admin |

Un message est bilingue : `{ title: { ru, en }, body: { ru, en }, active }`.
L'utilisateur lit la langue qu'il a choisie (repli sur le russe si la version
manque). Les brouillons (`active: false`) ne quittent jamais le serveur.
Un commentaire, lui, est un texte libre dans la langue que son auteur veut
(jusqu'à 600 caractères, jamais de HTML). Stockage : `data/messages.json`,
`data/comments.json` et `data/dispatches.json` (mêmes fichiers côté PHP).

## Journal et synthèse : deux fichiers

| Fichier | Rôle | Forme |
|---------|------|-------|
| `data/visits.json` | **le journal brut, intégral** — une entrée par visite, rien d'agrégé, rien de dédupliqué (toutes les IP traversées sont conservées) | tableau |
| `data/visits_summary.json` | **la synthèse** — dérivée du journal, une fiche par client + vue d'ensemble | objet |

La synthèse est régénérée à chaque écriture du journal : les deux fichiers ne
peuvent pas diverger. Si elle est absente ou ne correspond plus au journal
(édition manuelle, restauration), elle est reconstruite à la lecture suivante.
Elle ne recopie jamais les visites : elle référence sa source.

Tout est calculé à partir des **seules** données déjà envoyées par le
navigateur — aucune collecte supplémentaire.

### `data/visits.json` — le journal

```jsonc
[
  {
    "id": "v_m0abc_1f2e3d",
    "recordedAt": "2026-09-01T20:19:42.700Z",
    "deviceId": "d_…", "deviceConfirmed": true,
    "ip": "85.10.1.13",              // l'IP réelle de CETTE visite
    "geoIp": { "city": "Moscow", "country": "Russia", "isp": "…" },
    "language": "ru", "timezone": "Europe/Moscow",
    "screen": { "width": 412, "height": 915, "…": "…" },
    "userAgent": "…", "clientHints": { "…": "…" },
    "gpu": {}, "network": {}, "theme": {}, "voices": {}, "storage": {},
    "referrer": "https://ya.ru/", "consent": true
  }
  // … une entrée par visite, jusqu'à MAX_VISITS (800)
]
```

### `data/visits_summary.json` — la synthèse

```jsonc
{
  "generatedAt": "2026-09-01T20:19:42.700Z",
  "source": "data/visits.json",
  "summary": {                 // vue d'ensemble
    "totalVisits": 42, "uniqueClients": 17,
    "returningClients": 6, "newClients": 11,
    "returningRate": 0.353, "visitsPerClient": 2.47, "activeDays": 5,
    "firstVisitAt": "…", "lastVisitAt": "…",
    "gpsShared": 1, "automated": 0,
    "identifiedByCookie": 14,        // comptage exact
    "identifiedByFingerprint": 3,    // comptage approximatif
    "clientsWithRotatingIp": 5,      // appareils vus depuis plusieurs IP
    "topCountries": [{ "value": "Russia", "count": 9 }],
    "topCities": [], "topDevices": [], "topBrowsers": [], "topSystems": [],
    "topLanguages": [], "topTimezones": [], "topReferrers": [],
    "visitsByHourUTC": [{ "value": "20h", "count": 4 }]
  },
  "clients": [                 // une fiche par visiteur
    {
      "clientId": "c_33baca6a20fcf988",
      "identity": "device",          // "device" (exact) | "fingerprint" (approx.)
      "identityNote": "cookie propriétaire : un appareil distinct, même si son IP change",
      "visits": 3, "distinctDays": 2, "returning": true,
      "distinctIps": 7, "rotatingIp": true,
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
  ]
}
```

### Comment un « client » est identifié

Deux régimes, et le fichier dit toujours lequel s'applique (`identity`) :

| `identity` | `clientId` | Base | Fiabilité |
|-----------|-----------|------|-----------|
| `device` | `c_…` | cookie propriétaire `okno-device` (httpOnly, ~13 mois) | **exacte** — un appareil distinct, même si son IP change |
| `fingerprint` | `fp_…` | empreinte **sans IP** (système, navigateur, écran, GPU, langue, fuseau, cœurs, mémoire) | **approximative** — des appareils identiques peuvent être confondus |

**L'IP n'entre jamais dans l'identité.** Elle change trop vite (mobile, VPN,
CGNAT, proxys tournants) et fragmentait le comptage : un même téléphone
apparaissait autant de fois qu'il changeait d'adresse. Elle reste consultable
via `distinctIps` / `rotatingIp`, qui mesurent justement cette rotation.

Un cookie n'est pris en compte qu'une fois **représenté** par le navigateur
(`deviceConfirmed`). Un terminal qui refuse les cookies ne crée donc pas un
client fantôme à chaque visite : il bascule en `fingerprint`.

#### Cas d'une flotte de terminaux identiques à IP tournantes

C'est le scénario qui met en défaut toute empreinte passive : le matériel étant
identique, l'empreinte ne distingue pas les postes ; l'IP changeant sans cesse,
elle ne les suit pas.

- **Avec cookies** (cas normal) : comptage **exact**, chaque terminal est un
  client, quel que soit le nombre d'IP traversées. Couvert par
  `tests/visits-fleet.test.mjs`.
- **Sans cookies** : les terminaux identiques **fusionnent** en un seul client.
  C'est une limite intrinsèque, pas un réglage. Le fichier ne le masque pas :
  ces clients sont marqués `fingerprint` et comptés dans
  `identifiedByFingerprint`.

Pour une distinction certaine sans cookie, il faut un identifiant explicite
(paramètre d'URL par terminal, compte connecté, en-tête applicatif) — aucune
donnée passive du navigateur ne peut y suppléer.

Compatibilité : un ancien `visits.json` — tableau brut, ou version fusionnée
`{ summary, clients, visits }` — est toujours lu ; le journal reprend sa forme
de tableau et la synthèse repart dans son fichier dès l'écriture suivante,
sans perte de visites.

| Route | Effet |
|-------|-------|
| `GET /api/visits` | journal + `summary` + `clients` |
| `GET /api/visits/summary` (PHP : `api/visits.php?summary=1`) | synthèse seule, sans le journal |
| `GET /api/visits.json` | télécharge **le journal brut** |
| `GET /api/visits_summary.json` (PHP : `api/visits_summary.php`) | télécharge **la synthèse** |
| `POST /api/visit` | enregistre la visite et renvoie la `summary` à jour |
| `DELETE /api/visits` | vide le journal et remet la synthèse à zéro |

La page **Лаборатория / Laboratory** affiche cette synthèse : cartes de
totaux, classements (pays, appareils, navigateurs, systèmes, langues,
référents) et un tableau des clients.

## Deux versions

### 1. Version Node.js (originale) — `server.js` + `public/`
- Express + rss-parser + iconv-lite
- APIs : `/api/me`, `/api/news`, `/api/visit`, `/api/visits`, `/api/health`,
  `/api/messages`, `/api/comments` (lecture + écriture connectés), `/api/dispatches` (lecture + écriture admin)
- Authentification : `/api/auth/login|register|me|logout`, tableau de bord `/dashboard.html`
- Stockage `data/` (visits.json, visits_summary.json, users.json, sessions.json, dispatches.json, messages.json, comments.json, news_cache.json)
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
api/*.php + api/auth/*.php                          (backend, dont messages.php, comments.php et _content.php)
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
3. Test `/api/health` → `{"ok":true,…}`. La sonde est publique et n'expose donc
   pas la version de PHP : `php` et `data.accounts` n'apparaissent qu'en session
   rédaction (voir `infinityfree/README_INFINITYFREE.md`).

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
