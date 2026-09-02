<?php
/**
 * llms.php — servi sous /llms.txt (voir .htaccess).
 * llms.txt : un fichier Markdown à la racine qui résume le site en langage
 * clair pour les grands modèles (LLM) qui l'explorent.
 *   • /llms.txt          → vue d'ensemble + liens des pages
 *   • /llms.txt?full=1   → intègre aussi les titres des dernières dépêches
 */
require_once __DIR__ . '/seo-lib.php';
header('Content-Type: text/plain; charset=utf-8');
$base = seo_base_url();
$full = isset($_GET['full']);

echo "# ОКНО (OKNO) — Revue internationale\n\n";
echo "> «ОКНО» réunit, en une seule édition bilingue (russe / anglais), les unes des grandes rédactions russes : ТАСС, РИА Новости (RIA Novosti), Лента.ру (Lenta.ru), Коммерсантъ (Kommersant), Известия (Izvestia), Московский комсомолец (МК) et Газета.Ru (Gazeta.Ru). Dépêches d'actualité russe et internationale, classées par rubriques : monde, politique, économie, société, sport, culture.\n\n";
echo "> Projet pédagogique (revue éducative). Les dépêches proviennent des flux RSS publics des rédactions sources ; chaque article renvoie vers le site d'origine.\n\n";

echo "## Pages\n\n";
echo "- [$base/](Accueil — l'édition du jour, les unes des sept rédactions)\n";
echo "- [$base/laboratoire.html](Лаборатория / Laboratoire — synthèse pédagogique des métadonnées de navigation)\n";
echo "- [$base/confidentialite.html](Confidentialité — quelles métadonnées techniques la page lit, et pourquoi)\n";
echo "- [$base/informations-juridiques.html](Informations juridiques — nature du projet et mentions légales)\n";
echo "- [$base/contacts.html](Contacts de la rédaction)\n\n";

echo "## Données\n\n";
echo "- [$base/api/news](Flux JSON des dépêches — `{ items: [ { title, link, source, category, summary, image, publishedAt } ] }`, mis à jour en continu)\n";
echo "- [$base/sitemap.xml](Plan du site au format XML)\n\n";

if ($full) {
    $items = seo_news_items(60);
    if ($items) {
        echo "## Dernières dépêches\n\n";
        $i = 0;
        foreach ($items as $it) {
            if ($i++ >= 40) break;
            $title = seo_text($it['title']);
            $source = seo_text($it['source'] ?? '');
            $cat = seo_text($it['category'] ?? '');
            $line = '- ' . $title;
            $meta = trim($source . ($cat !== '' ? ' — ' . $cat : ''));
            if ($meta !== '') $line .= " ($meta)";
            if (!empty($it['link'])) $line .= ': ' . $it['link'];
            echo $line . "\n";
        }
        echo "\n";
    }
}
