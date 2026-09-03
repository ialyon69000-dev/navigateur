<?php
/**
 * sitemap.php — servi sous /sitemap.xml (voir .htaccess).
 * Liste les pages publiques indexables avec leur date de modification.
 */
require_once __DIR__ . '/seo-lib.php';
header('Content-Type: application/xml; charset=utf-8');
$base = seo_base_url();

// Date de dernière modification : fraîcheur du cache de dépêches si présent,
// sinon date du fichier de la page.
$newsMtime = @filemtime(__DIR__ . '/data/news_cache.json');
$homeLast = $newsMtime ? gmdate('c', $newsMtime) : gmdate('c', filemtime(__FILE__));

$pages = [
    ['path' => '/', 'priority' => '1.0', 'changefreq' => 'hourly', 'lastmod' => $homeLast],
    ['path' => '/laboratoire.html', 'priority' => '0.5', 'changefreq' => 'daily'],
    ['path' => '/confidentiality.html', 'priority' => '0.3', 'changefreq' => 'monthly'],
    ['path' => '/Legal-information.html', 'priority' => '0.3', 'changefreq' => 'monthly'],
    ['path' => '/contacts.html', 'priority' => '0.3', 'changefreq' => 'monthly'],
];

$xml = '<?xml version="1.0" encoding="UTF-8"?>' . "\n";
$xml .= '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' . "\n";
foreach ($pages as $p) {
    $file = __DIR__ . '/' . ltrim($p['path'], '/');
    if ($p['path'] === '/') $file = __DIR__ . '/index.php';
    $lastmod = $p['lastmod'] ?? (@file_exists($file) ? gmdate('c', filemtime($file)) : gmdate('c'));
    $xml .= "  <url>\n";
    $xml .= '    <loc>' . seo_h($base . $p['path']) . "</loc>\n";
    $xml .= "    <lastmod>$lastmod</lastmod>\n";
    $xml .= '    <changefreq>' . $p['changefreq'] . "</changefreq>\n";
    $xml .= '    <priority>' . $p['priority'] . "</priority>\n";
    $xml .= "  </url>\n";
}
$xml .= '</urlset>' . "\n";
echo $xml;
