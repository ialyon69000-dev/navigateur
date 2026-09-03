<?php
/**
 * llms.php — served as /llms.txt (see .htaccess).
 * llms.txt: a Markdown file at the root that summarizes the site in plain
 * language for large language models (LLMs) that crawl it.
 *   • /llms.txt          → overview + page links
 *   • /llms.txt?full=1   → also embeds the titles of the latest dispatches
 */
require_once __DIR__ . '/seo-lib.php';
header('Content-Type: text/plain; charset=utf-8');
$base = seo_base_url();
$full = isset($_GET['full']);

echo "# OKNO — International Review\n\n";
echo "> OKNO brings together, in a single bilingual edition (Russian / English), the front pages of major Russian newsrooms: TASS, RIA Novosti (RIA Novosti), Lenta.ru (Lenta.ru), Kommersant (Kommersant), Izvestia (Izvestia), Moskovskij Komsomolets (MK) and Gazeta.Ru (Gazeta.Ru). Russian and international news dispatches, sorted by sections: world, politics, economy, society, sport, culture.\n\n";
echo "> Educational project (learning review). Dispatches come from the public RSS feeds of the source newsrooms; each article links back to the original site.\n\n";

echo "## Pages\n\n";
echo "- [$base/](Home — today's edition, front pages of the seven newsrooms)\n";
echo "- [$base/laboratoire.html](Laboratory — educational synthesis of browsing metadata)\n";
echo "- [$base/confidentiality.html](Privacy — what technical metadata the page reads and why)\n";
echo "- [$base/Legal-information.html](Legal information — nature of the project and legal notices)\n";
echo "- [$base/contacts.html](Editorial contacts)\n\n";

echo "## Data\n\n";
echo "- [$base/api/news](JSON feed of dispatches — `{ items: [ { title, link, source, category, summary, image, publishedAt } ] }`, continuously updated)\n";
echo "- [$base/sitemap.xml](Site map in XML format)\n\n";

if ($full) {
    $items = seo_news_items(60);
    if ($items) {
        echo "## Latest dispatches\n\n";
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
