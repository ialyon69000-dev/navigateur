<?php
/**
 * seo-lib.php — petits utilitaires partagés pour l'indexation par les
 * moteurs de recherche et les aspirateurs de grands modèles (LLM).
 *
 * Prévu pour l'hébergement PHP gratuit (InfinityFree, 000webhost, etc.) :
 * aucune extension requise, simples file_get_contents / json_decode.
 *
 * On ne l'inclut que depuis des scripts *.php (l'accès direct au fichier
 * ne renvoie rien : il ne fait que définir des fonctions).
 */

/**
 * URL de base du site, sans barre oblique finale, calculée sur la requête
 * courante — fonctionne quel que soit le domaine (okho.ct.ws, hpd.in…).
 */
function seo_base_url()
{
    $https = (!empty($_SERVER['HTTPS']) && strtolower($_SERVER['HTTPS']) !== 'off')
        || (($_SERVER['SERVER_PORT'] ?? '') == 443)
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $scheme = $https ? 'https' : 'http';
    $host = $_SERVER['HTTP_HOST'] ?? ($_SERVER['SERVER_NAME'] ?? 'localhost');
    return $scheme . '://' . $host;
}

/** Échappe du texte pour une insertion dans un nœud texte ou un attribut HTML. */
function seo_h($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

/** Échappe du texte pour une valeur d'attribut JSON dans un <script>. */
function seo_json($data)
{
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    return $json === false ? 'null' : $json;
}

/**
 * Titre lisible d'une dépêche : le champ title peut être { ru, en } (bande
 * éditoriale) ou une simple chaîne (flux RSS) ; on retombe sur l'anglais.
 */
function seo_text($v, $lang = 'ru')
{
    if (is_array($v)) {
        if (isset($v[$lang]) && $v[$lang] !== '') return $v[$lang];
        if (isset($v['ru']) && $v['ru'] !== '') return $v['ru'];
        if (isset($v['en']) && $v['en'] !== '') return $v['en'];
        return '';
    }
    return (string)$v;
}

/**
 * Lit les dépêches du cache (même fichier que api/news.php), triées du plus
 * récent au plus ancien. Renvoie un tableau (vide si rien de lisible).
 */
function seo_news_items($limit = 60)
{
    $file = __DIR__ . '/data/news_cache.json';
    $raw = @file_get_contents($file);
    $data = json_decode($raw, true);
    if (!is_array($data) || empty($data['items']) || !is_array($data['items'])) return [];

    // D'abord tous les éléments valides, puis tri du plus récent au plus
    // ancien, ENFIN troncature : sinon on prendrait les N premiers dans
    // l'ordre du fichier sans tenir compte de la date.
    $items = [];
    foreach ($data['items'] as $it) {
        if (empty($it['title'])) continue;
        if (seo_text($it['title']) === '') continue;
        $items[] = $it;
    }
    usort($items, function ($a, $b) {
        $ta = isset($a['publishedAt']) ? strtotime((string)$a['publishedAt']) : 0;
        $tb = isset($b['publishedAt']) ? strtotime((string)$b['publishedAt']) : 0;
        return $tb - $ta;
    });
    return array_slice($items, 0, (int)$limit);
}

/**
 * Rendu HTML statique des dépêches pour les robots qui n'exécutent pas
 * JavaScript : une section <article> par dépêche, avec titre, source,
 * catégorie, date et lien sortant. Le JavaScript (app.js) remplace ce bloc
 * par l'édition mise en forme dès qu'il a chargé /api/news.
 */
function seo_news_html(array $items, $max = 40)
{
    if (!$items) {
        return '  <p>—</p>' . "\n";
    }
    $out = '';
    $i = 0;
    foreach ($items as $it) {
        if ($i++ >= $max) break;
        $title = seo_h(seo_text($it['title']));
        $source = seo_h($it['source'] ?? '');
        $cat = seo_h(seo_text($it['category'] ?? ''));
        $link = isset($it['link']) ? seo_h($it['link']) : '';
        $date = '';
        if (!empty($it['publishedAt'])) {
            $ts = strtotime((string)$it['publishedAt']);
            if ($ts) $date = gmdate('Y-m-d H:i', $ts) . ' UTC';
        }
        $meta = trim($source . ($cat !== '' ? ' · ' . $cat : '') . ($date !== '' ? ' · ' . $date : ''));
        if ($link !== '') {
            $out .= "      <article class=\"sr-news\">\n"
                 .  "        <h2><a href=\"$link\" rel=\"nofollow noopener\" target=\"_blank\">$title</a></h2>\n"
                 .  ($meta !== "" ? "        <p class=\"meta\">$meta</p>\n" : '')
                 .  "      </article>\n";
        } else {
            $out .= "      <article class=\"sr-news\">\n"
                 .  "        <h2>$title</h2>\n"
                 .  ($meta !== "" ? "        <p class=\"meta\">$meta</p>\n" : '')
                 .  "      </article>\n";
        }
    }
    return $out;
}

/**
 * Données structurées JSON-LD pour la page d'accueil :
 * Organization (NewsMediaOrganization), WebSite (moteur de recherche) et
 * ItemList des dernières dépêches (NewsArticle). C'est ce que lisent en
 * priorité Google News et les aspirateurs LLM.
 */
function seo_home_jsonld(array $items, $max = 30)
{
    $base = seo_base_url();
    $graph = [];

    $graph[] = [
        '@context' => 'https://schema.org',
        '@type' => 'NewsMediaOrganization',
        '@id' => $base . '/#organization',
        'name' => 'ОКНО',
        'alternateName' => 'OKNO — Revue internationale',
        'url' => $base . '/',
        'description' => 'Les unes des grandes rédactions russes, réunies en une édition. Учебное сетевое издание (projet pédagogique).',
        'inLanguage' => ['ru', 'en', 'fr'],
        'publishingPrinciples' => $base . '/Legal-information.html',
    ];

    $graph[] = [
        '@context' => 'https://schema.org',
        '@type' => 'WebSite',
        '@id' => $base . '/#website',
        'name' => 'ОКНО — Revue internationale',
        'url' => $base . '/',
        'inLanguage' => ['ru', 'en'],
        'publisher' => ['@id' => $base . '/#organization'],
        'potentialAction' => [
            '@type' => 'SearchAction',
            'target' => ['@type' => 'EntryPoint', 'urlTemplate' => $base . '/?q={search_term_string}'],
            'query-input' => 'required name=search_term_string',
        ],
    ];

    $list = [];
    $i = 0;
    foreach ($items as $it) {
        if ($i++ >= $max) break;
        $title = seo_text($it['title']);
        if ($title === '' || empty($it['link'])) continue;
        $art = [
            '@type' => 'NewsArticle',
            'headline' => mb_substr($title, 0, 110, 'UTF-8'),
            'mainEntityOfPage' => (string)$it['link'],
            'url' => (string)$it['link'],
            'author' => ['@type' => 'Organization', 'name' => isset($it['source']) ? seo_text($it['source']) : 'ОКНО'],
            'publisher' => ['@id' => $base . '/#organization'],
            'isAccessibleForFree' => true,
        ];
        if (!empty($it['publishedAt']) && strtotime((string)$it['publishedAt'])) {
            $art['datePublished'] = gmdate('c', strtotime((string)$it['publishedAt']));
            $art['dateModified'] = gmdate('c', strtotime((string)$it['publishedAt']));
        }
        if (!empty($it['image'])) {
            $art['image'] = (string)$it['image'];
        }
        $list[] = $art;
    }

    if ($list) {
        $graph[] = [
            '@context' => 'https://schema.org',
            '@type' => 'ItemList',
            'name' => 'Последние новости — OKNO',
            'itemListOrder' => 'https://schema.org/ItemListOrderDescending',
            'numberOfItems' => count($list),
            'itemListElement' => array_map(function ($idx, $art) {
                return [
                    '@type' => 'ListItem',
                    'position' => $idx + 1,
                    'item' => $art,
                ];
            }, array_keys($list), $list),
        ];
    }

    return $graph;
}
