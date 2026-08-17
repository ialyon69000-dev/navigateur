<?php
require __DIR__ . '/_common.php';

$FEEDS = [
    ['id' => 'tass', 'name' => 'TASS', 'url' => 'https://tass.ru/rss/v2.xml', 'color' => '#c8102e'],
    ['id' => 'ria', 'name' => 'RIA Novosti', 'url' => 'https://ria.ru/export/rss2/index.xml', 'color' => '#e30613'],
    ['id' => 'lenta', 'name' => 'Lenta.ru', 'url' => 'https://lenta.ru/rss', 'color' => '#ee1c25'],
    ['id' => 'kommersant', 'name' => 'Коммерсантъ', 'url' => 'https://www.kommersant.ru/RSS/main.xml', 'color' => '#111111'],
    ['id' => 'izvestia', 'name' => 'Известия', 'url' => 'https://iz.ru/xml/rss/all.xml', 'color' => '#1a3c6e'],
    ['id' => 'mk', 'name' => 'МК', 'url' => 'https://www.mk.ru/rss/index.xml', 'color' => '#b71c1c'],
    ['id' => 'gazeta', 'name' => 'Газета.Ru', 'url' => 'https://www.gazeta.ru/export/rss/first.xml', 'color' => '#2c3e50'],
];

function charsetOf($contentType, $xmlHead) {
    $fromHeader = null;
    if (preg_match('/charset=([^\\s;]+)/i', (string)$contentType, $m)) $fromHeader = $m[1];
    $fromXml = null;
    if (preg_match('/encoding=[\"\\']([^\"\\']+)[\"\\']/i', (string)$xmlHead, $m2)) $fromXml = $m2[1];
    $cs = strtolower(trim(str_replace(['"', "'"], '', $fromHeader ?: ($fromXml ?: 'utf-8'))));
    if ($cs === 'cp1251' || $cs === 'windows-1251' || $cs === 'win-1251') return 'windows-1251';
    if ($cs === 'utf8') return 'utf-8';
    return $cs;
}

function safeSubstr($value, $start, $length = null) {
    $value = (string)$value;
    if (function_exists('mb_substr')) return $length === null ? mb_substr($value, $start) : mb_substr($value, $start, $length);
    return $length === null ? substr($value, $start) : substr($value, $start, $length);
}

function safeLower($value) {
    return function_exists('mb_strtolower') ? mb_strtolower((string)$value) : strtolower((string)$value);
}

function looksBrokenCyrillic($s) {
    $sample = safeSubstr((string)$s, 0, 3000);
    preg_match_all('/[А-Яа-яЁё]/u', $sample, $m);
    $cyr = count($m[0]);
    $repl = substr_count($sample, '�');
    return $cyr < 10 || $repl > 4;
}

function decodeEntities($s) {
    $s = (string)$s;
    $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $s = str_replace(["\xc2\xa0"], ' ', $s);
    return $s;
}

function stripHtmlCustom($s) {
    $s = (string)$s;
    $s = preg_replace('/<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>/u', '$1', $s);
    $s = preg_replace('/<script[\\s\\S]*?<\\/script>/iu', ' ', $s);
    $s = preg_replace('/<style[\\s\\S]*?<\\/style>/iu', ' ', $s);
    $s = strip_tags($s);
    $s = decodeEntities($s);
    $s = preg_replace('/\\s*\\/\\/\\s*/', ' — ', $s);
    $s = preg_replace('/\\s+/u', ' ', trim($s));
    return $s;
}

function pickImage($itemXml, $itemAssoc) {
    // enclosure
    if (!empty($itemAssoc['enclosure_url'])) {
        $url = $itemAssoc['enclosure_url'];
        $type = $itemAssoc['enclosure_type'] ?? '';
        if (preg_match('/image|jpg|jpeg|png|webp|gif/i', $type.$url)) return $url;
    }
    // media:content
    if (!empty($itemAssoc['media_content'])) return $itemAssoc['media_content'];
    if (!empty($itemAssoc['media_thumb'])) return $itemAssoc['media_thumb'];
    // img in description
    $html = $itemAssoc['description_html'] ?? '';
    if (preg_match('/<img[^>]+src=[\"\\']([^\"\\']+)[\"\\']/i', $html, $m)) return $m[1];
    return null;
}

function guessImage($link, $feedId, $picked) {
    if ($picked) return $picked;
    if ($feedId === 'ria') {
        if (preg_match('/(\\d{7,})\\.html/', $link, $m)) return "https://cdnn21.img.ria.ru/images/sharing/article/{$m[1]}.jpg";
    }
    if ($feedId === 'kommersant') {
        if (preg_match('/\\/doc\\/(\\d+)/', $link, $m)) return "https://iv.kommersant.ru/SocialPics/{$m[1]}";
    }
    return null;
}

/**
 * Download every RSS file at the same time.  Free shared hosting has a short
 * request limit; fetching seven sources one after another could therefore
 * take 84 seconds and Apache would kill /api/news before it sent JSON.
 */
function fetchFeedsInParallel($feeds, $timeout = 8) {
    if (!function_exists('curl_multi_init')) return null;

    $multi = curl_multi_init();
    $handles = [];
    foreach ($feeds as $index => $feed) {
        $ch = curl_init($feed['url']);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => 'OKNO/1.1 RSS reader',
            CURLOPT_HTTPHEADER => ['Accept: application/rss+xml, application/xml, text/xml, */*'],
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        curl_multi_add_handle($multi, $ch);
        $handles[$index] = $ch;
    }

    $running = null;
    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) curl_multi_select($multi, 0.5);
    } while ($running && $status === CURLM_OK);

    $results = [];
    foreach ($handles as $index => $ch) {
        $body = curl_multi_getcontent($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $type = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $error = curl_error($ch);
        if ($body === false || $code >= 400 || $code === 0) {
            $results[$index] = ['error' => $error ?: ('http ' . $code)];
        } else {
            $results[$index] = ['body' => $body, 'contentType' => $type];
        }
        curl_multi_remove_handle($multi, $ch);
        curl_close($ch);
    }
    curl_multi_close($multi);
    return $results;
}

function fetchFeedPhp($feed, $prefetched = null) {
    if ($prefetched !== null) {
        $buf = $prefetched['body'];
        $ctype = $prefetched['contentType'];
    } else {
        list($buf, $ctype) = httpFetch($feed['url'], 5);
    }
    // buf is binary string
    $head = substr($buf, 0, 220);
    $charset = charsetOf($ctype, $head);
    $xml = $buf;
    // try decode
    if (strtolower($charset) === 'windows-1251' || strtolower($charset) === 'cp1251' || strtolower($charset) === 'win-1251') {
        if (function_exists('iconv')) {
            $converted = @iconv('windows-1251', 'UTF-8//IGNORE', $buf);
            if ($converted !== false) $xml = $converted;
        } elseif (function_exists('mb_convert_encoding')) {
            $xml = @mb_convert_encoding($buf, 'UTF-8', 'windows-1251');
        }
    } else {
        // try utf8, but detect broken
        if (function_exists('mb_check_encoding') && !mb_check_encoding($buf, 'UTF-8')) {
            if (function_exists('iconv')) {
                $converted = @iconv('windows-1251', 'UTF-8//IGNORE', $buf);
                if ($converted !== false && mb_strlen($converted) > 100) $xml = $converted;
            }
        }
    }
    if (looksBrokenCyrillic($xml)) {
        if (function_exists('iconv')) {
            $converted = @iconv('windows-1251', 'UTF-8//IGNORE', $buf);
            if ($converted !== false) $xml = $converted;
        }
    }
    $xml = ltrim($xml, "\xEF\xBB\xBF");
    // clean invalid chars for SimpleXML
    $xml = preg_replace('/[^\\x{0009}\\x{000A}\\x{000D}\\x{0020}-\\x{D7FF}\\x{E000}-\\x{FFFD}\\x{10000}-\\x{10FFFF}]/u', '', $xml);

    libxml_use_internal_errors(true);
    if (!function_exists('simplexml_load_string')) {
        throw new Exception('L’extension PHP SimpleXML est indisponible sur cet hébergement');
    }
    $sxml = simplexml_load_string($xml, 'SimpleXMLElement', LIBXML_NOCDATA);
    if (!$sxml) {
        throw new Exception('XML parse failed for ' . $feed['name']);
    }
    $items = [];
    // Support both RSS and Atom-ish: channel->item or //item
    $rawItems = [];
    if (isset($sxml->channel->item)) $rawItems = $sxml->channel->item;
    elseif (isset($sxml->item)) $rawItems = $sxml->item;
    else {
        // try xpath
        $rawItems = $sxml->xpath('//item') ?: [];
    }
    $count = 0;
    foreach ($rawItems as $it) {
        if ($count >= 24) break;
        $namespaces = $it->getNamespaces(true);
        $media = null; $thumb = null;
        if (isset($namespaces['media'])) {
            $mediaChildren = $it->children($namespaces['media']);
            if (isset($mediaChildren->content)) {
                $attrs = $mediaChildren->content->attributes();
                if (isset($attrs['url'])) $media = (string)$attrs['url'];
            }
            if (isset($mediaChildren->thumbnail)) {
                $attrs = $mediaChildren->thumbnail->attributes();
                if (isset($attrs['url'])) $thumb = (string)$attrs['url'];
            }
        }
        $enclosureUrl = null; $enclosureType = null;
        if (isset($it->enclosure)) {
            $attrs = $it->enclosure->attributes();
            $enclosureUrl = (string)($attrs['url'] ?? '');
            $enclosureType = (string)($attrs['type'] ?? '');
        }
        $title = (string)($it->title ?? '');
        $link = (string)($it->link ?? '');
        if (empty($link) && isset($it->guid)) $link = (string)$it->guid;
        $guid = (string)($it->guid ?? $link ?: $feed['id'].'-'.$title);
        $pub = (string)($it->pubDate ?? $it->children()->pubDate ?? $it->updated ?? $it->children()->updated ?? '');
        $iso = null;
        if ($pub) {
            $ts = strtotime($pub);
            if ($ts !== false) $iso = gmdate('c', $ts);
            else $iso = $pub;
        }
        $cat = '';
        if (isset($it->category)) {
            if (is_array($it->category) || $it->category instanceof Traversable) {
                // take first
                $cat = (string)($it->category[0] ?? '');
            } else $cat = (string)$it->category;
        }
        $descHtml = '';
        if (isset($it->description)) $descHtml = (string)$it->description;
        elseif (isset($it->children('content', true)->encoded)) $descHtml = (string)$it->children('content', true)->encoded;
        $summary = safeSubstr(stripHtmlCustom($descHtml ?: $title), 0, 280);

        $assoc = [
            'enclosure_url' => $enclosureUrl,
            'enclosure_type' => $enclosureType,
            'media_content' => $media,
            'media_thumb' => $thumb,
            'description_html' => $descHtml,
        ];
        $picked = pickImage($it, $assoc);
        $image = guessImage($link, $feed['id'], $picked);

        $items[] = [
            'id' => $guid ?: $feed['id'].'-'.md5($title.$link),
            'title' => stripHtmlCustom($title) ?: '(sans titre)',
            'link' => $link ?: '#',
            'source' => $feed['name'],
            'sourceId' => $feed['id'],
            'color' => $feed['color'],
            'category' => stripHtmlCustom($cat) ?: null,
            'publishedAt' => $iso,
            'summary' => $summary,
            'image' => $image,
        ];
        $count++;
    }
    return $items;
}

// caching
$force = isset($_GET['refresh']) && $_GET['refresh'] === '1';
$nowMs = (int)(microtime(true)*1000);
$cache = null;
if (file_exists($NEWS_CACHE_FILE) && !$force) {
    $raw = @file_get_contents($NEWS_CACHE_FILE);
    $j = json_decode($raw, true);
    // Never make a visitor wait for remote publishers. A populated cache is
    // served immediately, even when old; use ?refresh=1 to attempt an update.
    // This is deliberately resilient to restrictive free-hosting networks.
    if ($j && !empty($j['items'])) {
        $cache = $j;
    }
}
$staleCache = isset($j) && is_array($j) && !empty($j['items']) ? $j : null;
if ($cache) {
    header('Content-Type: application/json; charset=utf-8');
    header('X-Cache: ' . (($nowMs - (int)($cache['at'] ?? 0) < 5*60*1000) ? 'HIT' : 'STALE'));
    echo json_encode([
        'updatedAt' => gmdate('c', (int)($cache['at']/1000)),
        'sources' => array_map(function($f){ return ['id'=>$f['id'],'name'=>$f['name']]; }, $FEEDS),
        'items' => $cache['items'],
        'errors' => $cache['errors'] ?? [],
    ], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    exit;
}

$allItems = [];
$errors = [];
$downloads = fetchFeedsInParallel($FEEDS);
foreach ($FEEDS as $index => $feed) {
    try {
        if ($downloads !== null && !empty($downloads[$index]['error'])) {
            throw new Exception($downloads[$index]['error']);
        }
        // curl_multi is unavailable on a few PHP builds.  Keep that fallback
        // bounded as well, instead of allowing a request to run indefinitely.
        $items = fetchFeedPhp($feed, $downloads !== null ? $downloads[$index] : null);
        $allItems = array_merge($allItems, $items);
    } catch (Throwable $e) {
        // PHP raises Error (not Exception) when a shared host misses an
        // extension.  Keep answering JSON so the frontend can recover.
        $errors[] = ['source' => $feed['name'], 'error' => $e->getMessage()];
    }
}

usort($allItems, function($a,$b){
    $da = $a['publishedAt'] ? strtotime($a['publishedAt']) : 0;
    $db = $b['publishedAt'] ? strtotime($b['publishedAt']) : 0;
    return $db <=> $da;
});

$seen = [];
$unique = [];
foreach ($allItems as $it) {
    $key = safeLower(safeSubstr($it['title'] ?? '', 0, 80));
    if (isset($seen[$key])) continue;
    $seen[$key] = true;
    $unique[] = $it;
}

$balanced = [];
$leftover = [];
$perSource = [];
foreach ($unique as $it) {
    $n = $perSource[$it['sourceId']] ?? 0;
    if ($n < 12) {
        $balanced[] = $it;
        $perSource[$it['sourceId']] = $n+1;
    } else $leftover[] = $it;
}
$final = array_slice(array_merge($balanced, $leftover), 0, 120);

// A stale but populated feed is much more useful than an empty page when the
// host temporarily blocks outgoing connections to the publishers.
if (empty($final) && $staleCache) {
    header('Content-Type: application/json; charset=utf-8');
    header('X-Cache: STALE');
    echo json_encode([
        'updatedAt' => gmdate('c', (int)($staleCache['at'] / 1000)),
        'sources' => array_map(function($f){ return ['id'=>$f['id'],'name'=>$f['name']]; }, $FEEDS),
        'items' => $staleCache['items'],
        'errors' => $errors,
    ], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
    exit;
}

$payload = [
    'at' => $nowMs,
    'items' => $final,
    'errors' => $errors,
];
@file_put_contents($NEWS_CACHE_FILE, json_encode($payload, JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES));

header('Content-Type: application/json; charset=utf-8');
header('X-Cache: MISS');
echo json_encode([
    'updatedAt' => gmdate('c'),
    'sources' => array_map(function($f){ return ['id'=>$f['id'],'name'=>$f['name']]; }, $FEEDS),
    'items' => $final,
    'errors' => $errors,
], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
