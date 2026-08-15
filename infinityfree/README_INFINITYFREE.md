# Portage InfinityFree — OKNO

## Réponse rapide
**Non, le projet Node.js actuel ne peut PAS tourner tel quel sur InfinityFree gratuit.**

- InfinityFree gratuit = Apache + PHP + MySQL uniquement, pas de Node.js, pas de `npm install`, pas de `node server.js` [5](https://stackoverflow.com/questions/68023391/how-to-host-a-node-js-web-server-that-can-handle-requests-in-port-with-github-pa)
- Le forum officiel confirme : "InfinityFree does not support Node.js" / "You can't install Node.js on web hosting" [3](https://forum.infinityfree.com/t/does-node-js-support-socket-io/106975) [4](https://forum.infinityfree.com/t/to-this-q-can-i-install-node-js/93083/6)
- Seule l'offre Premium (iFastNet) propose "Python/Ruby/Node.js Support" via cPanel [2](https://www.infinityfree.com/premium/)

## Ce que j'ai préparé pour toi
Dans `infinityfree/htdocs/` tu as une version 100% PHP prête à uploader :

```
htdocs/
  index.html, styles.css, app.js (originaux)
  .htaccess → rewrite /api/* vers api/*.php
  api/
    _common.php → fonctions partagées (IP, geo ipwho.is, visits)
    me.php → /api/me
    news.php → /api/news avec cache 5min, gestion win1251→utf8
    visit.php → /api/visit POST
    visits.php → /api/visits GET/DELETE
    health.php
  data/
    visits.json (doit être writable 666)
    news_cache.json
    .htaccess → deny all
```

Le frontend `app.js` reste identique, il appelle `/api/me`, `/api/news`, `/api/visit` comme avant.

### Différences / limitations InfinityFree

1. **Cache** : on ne peut pas garder en mémoire vive. On utilise `data/news_cache.json` fichier avec TTL 5 min.
2. **Visits** : stockées en JSON comme avant, avec `flock`. Sur InfinityFree le FS est persistant mais peut être vidé. Pour de la prod, remplacer par MySQL.
3. **IP Geolocation** : identique (ipwho.is) via cURL. Si InfinityFree bloque outbound, ça tombera en `source: unavailable` mais le site reste fonctionnel.
4. **Security system** : InfinityFree injecte un challenge JS `_test` / `cdn-cgi`. Les fetchs XHR depuis le même domaine passent car le cookie est posé après visite page. Pas de WebSocket [1](https://forum.infinityfree.com/t/can-i-use-websocket-in-my-website-using-node-js/100630).
5. **Limites** : 50k hits/jour, 10% CPU, pas de cron. Le chargement initial des 7 RSS peut être un peu lent (12s timeout).

## Déploiement

1. Crée compte InfinityFree → domaine → File Manager ou FTP
2. Upload le contenu de `infinityfree/htdocs/` dans `htdocs/` sur le serveur (pas le dossier lui-même)
3. Dans cPanel InfinityFree, chmod 666 sur `htdocs/data/visits.json` et `news_cache.json` (ou 777 sur dossier `data` si bloqué)
4. PHP version 8.1 ou 8.2 recommandée
5. Teste : `https://tondomaine/api/health` → `{"ok":true}`

## 3 stratégies possibles

### A. Full PHP (ce que je viens de faire)
- Avantages : gratuit, tout sur InfinityFree
- Inconvénients : un peu moins performant que Node, parsing XML en PHP

### B. Hybride : Frontend InfinityFree + Backend Render
- Garde ton `server.js` actuel sur Render (tu as déjà `render.yaml`)
- Sur InfinityFree, `htdocs/` = seulement statique, et `app.js` appelle `https://ton-app.onrender.com/api/news` avec CORS enabled
- Avantages : pas besoin de réécrire
- Inconvénients : 2 hébergements, CORS, latence

### C. InfinityFree Premium / iFastNet
- Il supporte Node.js via cPanel. Tu peux alors pusher `server.js` en mode Node App.
- Coût ~$3.99/mois mais garde code actuel [2](https://www.infinityfree.com/premium/)

## Si tu veux que je finalise

Dis-moi quelle stratégie tu préfères :
- Je peux pousser la version PHP (ajuster `app.js` pour debug, MySQL au lieu de JSON)
- Ou ajouter config CORS pour mode hybride
- Ou créer un `Dockerfile` pour iFastNet Node

Actuellement `infinityfree/htdocs/` est fonctionnel en local avec `php -S localhost:8000 -t htdocs` → teste-le avec `php -S`.
