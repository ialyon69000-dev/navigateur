<?php
/**
 * index.php — édition « Технические работы » (page de maintenance).
 *
 * Même page que la version Node (`public/index.html`), portée en PHP pour
 * l'hébergement InfinityFree : mêmes textes bilingues RU/EN, même feuille de
 * style (`maintenance.css`) et même script (`maintenance.js`), servis depuis
 * `htdocs/`.
 *
 * Deux différences volontaires avec la copie statique, permises par PHP :
 *   • la date de la manchette et le numéro d'édition sont calculés côté
 *     serveur (heure de Moscou, comme app.js) : la page reste juste même sans
 *     JavaScript, et ne vieillit pas si la maintenance dure ;
 *   • la page n'ouvre aucun fichier de `data/` et n'inclut pas `seo-lib.php` :
 *     elle s'affiche même si le cache des dépêches ou le dossier `data/` est
 *     cassé — c'est précisément le cas où l'on coupe le site.
 *
 * Portée : la page d'accueil seulement. Les autres pages (contacts, mentions
 * légales, /auth/*, dashboard) et l'API restent servies normalement.
 *
 * Pour revenir à l'édition : `git revert` du commit qui a introduit cette page
 * (ou `git checkout <commit> -- infinityfree/htdocs/index.php`), puis renvoyer
 * `index.php` sur le serveur.
 */

// Heure de la rédaction : Moscou, comme le reste du site (app.js).
$now = new DateTime('now', new DateTimeZone('Europe/Moscow'));

// Noms de mois en russe (génitif) : ni strftime (déprécié) ni l'extension
// intl ne sont garantis sur un hébergement PHP gratuit.
$moisRu = [
    1 => 'января', 2 => 'февраля', 3 => 'марта', 4 => 'апреля',
    5 => 'мая', 6 => 'июня', 7 => 'июля', 8 => 'августа',
    9 => 'сентября', 10 => 'октября', 11 => 'ноября', 12 => 'декабря',
];
$dateIso = $now->format('Y-m-d');
$dateRu  = $now->format('j') . ' ' . $moisRu[(int)$now->format('n')] . ' ' . $now->format('Y');
$edition = '№ ' . $now->format('m') . '/' . $now->format('y');
$annee   = $now->format('Y');

header('Content-Type: text/html; charset=utf-8');
// Jamais mise en cache : dès que l'édition revient, le visiteur la voit.
header('Cache-Control: no-store, max-age=0');
// Variante « SEO » : au lieu du <meta name="robots" content="noindex"> plus
// bas, signaler aux moteurs une indisponibilité temporaire (recommandé si la
// maintenance dure plusieurs jours). Vérifier ensuite que l'hébergeur ne
// remplace pas la page par son propre écran d'erreur :
// http_response_code(503);
// header('Retry-After: 3600');
?><!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ОКНО — Технические работы</title>
  <meta name="description" content="ОКНО is currently undergoing scheduled maintenance." />
  <meta name="robots" content="noindex, nofollow" />
  <meta name="theme-color" content="#f4efe4" />
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect fill='%2314100c' width='32' height='32'/%3E%3Ctext x='16' y='22' text-anchor='middle' font-size='16' fill='%23c5a46e' font-family='serif'%3EО%3C/text%3E%3C/svg%3E" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500&family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/maintenance.css" />
</head>
<body class="maintenance-page">
  <div class="paper-bg" aria-hidden="true"></div>

  <div class="lang-switch" role="group" aria-label="Language / Язык">
    <button type="button" class="lang-btn is-active" data-language="ru" aria-label="Русский" aria-pressed="true"><img src="/images/ru.svg" alt="" /></button>
    <button type="button" class="lang-btn" data-language="en" aria-label="English" aria-pressed="false"><img src="/images/en.svg" alt="" /></button>
  </div>

  <header class="maintenance-header">
    <div class="header-rail">
      <span class="rail-copy" data-ru="Специальный выпуск" data-en="Special edition">Специальный выпуск</span>
      <span class="rail-dot" aria-hidden="true"></span>
      <time id="today" datetime="<?php echo $dateIso; ?>"><?php echo $dateRu; ?></time>
      <span class="rail-dot" aria-hidden="true"></span>
      <span><?php echo $edition; ?></span>
    </div>

    <a class="mast" href="/" aria-label="ОКНО — главная">
      <span class="mast-ornament" aria-hidden="true">✦</span>
      <h1 class="mast-title">ОКНО</h1>
      <p class="mast-line" data-ru="Обозрение · Москва, Петербург, мир" data-en="Review · Moscow, Petersburg, the world">Обозрение · Москва, Петербург, мир</p>
      <span class="mast-ornament" aria-hidden="true">✦</span>
    </a>

    <div class="maintenance-rule" aria-hidden="true">
      <span data-ru="Редакционное сообщение" data-en="Editorial notice">Редакционное сообщение</span>
    </div>
  </header>

  <main class="maintenance-main">
    <section class="maintenance-card" aria-labelledby="maintenance-title">
      <div class="status-line">
        <span class="update-pulse" aria-hidden="true"></span>
        <span data-ru="Технические работы" data-en="Maintenance in progress">Технические работы</span>
      </div>

      <p class="issue-number" aria-hidden="true">01</p>
      <h2 id="maintenance-title" data-ru="Мы скоро вернёмся" data-en="We’ll be back shortly">Мы скоро вернёмся</h2>
      <p class="lead" data-ru="Сейчас редакция «ОКНО» проводит плановые технические работы, чтобы сделать издание быстрее, надёжнее и удобнее." data-en="The OKNO editorial team is carrying out scheduled maintenance to make the publication faster, more reliable and easier to use.">Сейчас редакция «ОКНО» проводит плановые технические работы, чтобы сделать издание быстрее, надёжнее и удобнее.</p>

      <div class="ornament-divider" aria-hidden="true"><span>◆</span></div>

      <p class="detail" data-ru="В это время материалы сайта временно недоступны. Спасибо за терпение — свежий выпуск уже готовится." data-en="During this time, the site’s articles are temporarily unavailable. Thank you for your patience — the next edition is already being prepared.">В это время материалы сайта временно недоступны. Спасибо за терпение — свежий выпуск уже готовится.</p>

      <div class="return-note">
        <span class="return-label" data-ru="Статус редакции" data-en="Editorial status">Статус редакции</span>
        <strong data-ru="Работы идут по плану" data-en="Work is proceeding as planned">Работы идут по плану</strong>
      </div>
    </section>

    <aside class="side-note" aria-label="Information">
      <span class="side-note-index">ОКНО / <?php echo $annee; ?></span>
      <blockquote data-ru="«Небольшая пауза, чтобы лучше видеть мир»." data-en="“A short pause, so we can see the world more clearly.”">«Небольшая пауза, чтобы лучше видеть мир».</blockquote>
      <p data-ru="Редакция ОКНО" data-en="The OKNO editorial team">Редакция ОКНО</p>
    </aside>
  </main>

  <footer class="maintenance-footer">
    <div class="footer-line"></div>
    <div class="maintenance-footer-inner">
      <span>© <?php echo $annee; ?> «ОКНО»</span>
      <span data-ru="Общественно-политическое обозрение" data-en="International news review">Общественно-политическое обозрение</span>
      <span>18+</span>
    </div>
  </footer>

  <script src="/maintenance.js"></script>
</body>
</html>
