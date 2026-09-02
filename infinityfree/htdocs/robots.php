<?php
/**
 * robots.php — servi sous /robots.txt (voir .htaccess).
 *
 * Règle d'indexation :
 *   • pages publiques en clair : accueillies (home, infos, laboratoire) ;
 *   • comptes, tableau de bord, données, API d'écriture et exercice
 *     phishing : interdits à tous les robots ;
 *   • les aspirateurs LLM/IA sont explicitement autorisés sur le contenu
 *     public (OpenAI GPTBot, Anthropic ClaudeBot, Perplexity, Google
 *     AI-Overviews/AI crawler, CCBot, etc.).
 */
require_once __DIR__ . '/seo-lib.php';
header('Content-Type: text/plain; charset=utf-8');
$base = seo_base_url();

// Dossiers / routes qui ne doivent jamais être indexés.
$disallow = [
    '/auth/',          // connexion, inscription, tableau de rédaction
    '/dashboard',      // tableau de bord
    '/vk.html',        // exercice de phishing pédagogique
    '/log.php',        // récepteur de l'exercice
    '/data/',          // fichiers JSON (déjà protégés par .htaccess)
    '/api/',           // points d'API (formats JSON, pas des pages)
];

// Les grandes familles d'aspirateurs LLM/IA : on les accueille sur le public.
$aiBots = [
    'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',           // OpenAI
    'ClaudeBot', 'Claude-Web', 'anthropic-ai',           // Anthropic
    'PerplexityBot', 'Perplexity-User',                  // Perplexity
    'Google-Extended', 'GoogleOther',                    // Google AI / Gemini
    'APIs-Google',
    'CCBot',                                              // Common Crawl
    'cohere-ai', 'Cohere-AI',
    'Amazonbot',                                          // Amazon / Alexa
    'Applebot-Extended',                                  // Apple Intelligence
    'Meta-ExternalAgent', 'facebookexternalhit',          // Meta
    'Bytespider',                                         // ByteDance / Doubao
    'Timpibot',                                           // YouBot / You.com
    'webzio-extended',
];

$out = "User-agent: *\n";
foreach ($disallow as $d) {
    $out .= "Disallow: $d\n";
}
$out .= "Allow: /\n";
$out .= "\n";

foreach ($aiBots as $bot) {
    $out .= "User-agent: $bot\n";
    $out .= "Allow: /\n";
    foreach ($disallow as $d) {
        $out .= "Disallow: $d\n";
    }
    $out .= "\n";
}

$out .= "Sitemap: $base/sitemap.xml\n";
echo $out;
