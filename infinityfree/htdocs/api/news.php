<?php
/*
 * Emergency-safe news endpoint for restrictive shared PHP hosting.
 *
 * Always answers with the last known dispatches immediately. RSS is only
 * fetched when refresh=1 (background) or when the cache is empty, so the
 * page never waits on outbound feeds.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

$MIN_ITEMS = 50;
$STALE_SECONDS = 3 * 60;
$REMOTE_RETRY_SECONDS = 90;
$DATA_DIR = dirname(__FILE__) . '/../data';
$cacheFile = $DATA_DIR . '/news_cache.json';
$embeddedFile = $DATA_DIR . '/news_embedded.json';
$attemptFile = $DATA_DIR . '/news_remote_attempt.json';

$REMOTE_URLS = array(
    'https://raw.githubusercontent.com/ialyon69000-dev/navigateur/main/infinityfree/htdocs/data/news_cache.json',
    'https://cdn.jsdelivr.net/gh/ialyon69000-dev/navigateur@main/infinityfree/htdocs/data/news_cache.json',
);

$FEEDS = array(
    array('id' => 'tass', 'name' => 'TASS', 'url' => 'https://tass.ru/rss/v2.xml', 'color' => '#c8102e'),
    array('id' => 'ria', 'name' => 'RIA Novosti', 'url' => 'https://ria.ru/export/rss2/index.xml', 'color' => '#e30613'),
    array('id' => 'lenta', 'name' => 'Lenta.ru', 'url' => 'https://lenta.ru/rss', 'color' => '#ee1c25'),
    array('id' => 'kommersant', 'name' => 'Коммерсантъ', 'url' => 'https://www.kommersant.ru/RSS/main.xml', 'color' => '#111111'),
    array('id' => 'izvestia', 'name' => 'Известия', 'url' => 'https://iz.ru/xml/rss/all.xml', 'color' => '#1a3c6e'),
    array('id' => 'mk', 'name' => 'МК', 'url' => 'https://www.mk.ru/rss/index.xml', 'color' => '#b71c1c'),
    array('id' => 'gazeta', 'name' => 'Газета.Ru', 'url' => 'https://www.gazeta.ru/export/rss/first.xml', 'color' => '#2c3e50'),
);

function news_http_get($url, $timeout = 5) {
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_USERAGENT => 'OKNO news cache/1.1',
            CURLOPT_HTTPHEADER => array('Accept: application/json, */*'),
            CURLOPT_SSL_VERIFYPEER => true,
        ));
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        if ($body !== false && $code >= 200 && $code < 400) {
            return $body;
        }
        return null;
    }
    $ctx = stream_context_create(array(
        'http' => array(
            'method' => 'GET',
            'timeout' => $timeout,
            'header' => "User-Agent: OKNO news cache/1.1\r\nAccept: application/json, */*\r\n",
        ),
    ));
    $body = @file_get_contents($url, false, $ctx);
    return $body === false ? null : $body;
}

function news_read_payload($file) {
    $raw = @file_get_contents($file);
    $data = @json_decode($raw, true);
    if (!is_array($data) || empty($data['items']) || !is_array($data['items'])) {
        return null;
    }
    return $data;
}

function news_write_payload($file, $data) {
    $dir = dirname($file);
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return false;
    }
    return @file_put_contents($file, $json . "\n") !== false;
}

function news_sort_by_date($a, $b) {
    $ta = isset($a['publishedAt']) ? $a['publishedAt'] : '';
    $tb = isset($b['publishedAt']) ? $b['publishedAt'] : '';
    if ($ta === $tb) {
        return 0;
    }
    return ($ta > $tb) ? -1 : 1;
}

function news_cp1251_to_utf8($raw) {
    static $map = null;
    if ($map === null) {
        $special = array(
            0x80 => 0x0402, 0x81 => 0x0403, 0x82 => 0x201A, 0x83 => 0x0453,
            0x84 => 0x201E, 0x85 => 0x2026, 0x86 => 0x2020, 0x87 => 0x2021,
            0x88 => 0x20AC, 0x89 => 0x2030, 0x8A => 0x0409, 0x8B => 0x2039,
            0x8C => 0x040A, 0x8D => 0x040C, 0x8E => 0x040B, 0x8F => 0x040F,
            0x90 => 0x0452, 0x91 => 0x2018, 0x92 => 0x2019, 0x93 => 0x201C,
            0x94 => 0x201D, 0x95 => 0x2022, 0x96 => 0x2013, 0x97 => 0x2014,
            0x99 => 0x2122, 0x9A => 0x0459, 0x9B => 0x203A, 0x9C => 0x045A,
            0x9D => 0x045C, 0x9E => 0x045B, 0x9F => 0x045F, 0xA0 => 0x00A0,
            0xA1 => 0x040E, 0xA2 => 0x045E, 0xA3 => 0x0408, 0xA4 => 0x00A4,
            0xA5 => 0x0490, 0xA6 => 0x00A6, 0xA7 => 0x00A7, 0xA8 => 0x0401,
            0xA9 => 0x00A9, 0xAA => 0x0404, 0xAB => 0x00AB, 0xAC => 0x00AC,
            0xAD => 0x00AD, 0xAE => 0x00AE, 0xAF => 0x0407, 0xB0 => 0x00B0,
            0xB1 => 0x00B1, 0xB2 => 0x0406, 0xB3 => 0x0456, 0xB4 => 0x0491,
            0xB5 => 0x00B5, 0xB6 => 0x00B6, 0xB7 => 0x00B7, 0xB8 => 0x0451,
            0xB9 => 0x2116, 0xBA => 0x0454, 0xBB => 0x00BB, 0xBC => 0x0458,
            0xBD => 0x0405, 0xBE => 0x0455, 0xBF => 0x0457,
        );
        $map = $special;
        for ($b = 0xC0; $b <= 0xFF; $b++) {
            $map[$b] = 0x0410 + ($b - 0xC0);
        }
    }
    $out = '';
    $len = strlen($raw);
    for ($i = 0; $i < $len; $i++) {
        $b = ord($raw[$i]);
        if ($b < 0x80) {
            $out .= $raw[$i];
            continue;
        }
        if (!isset($map[$b])) {
            continue;
        }
        $cp = $map[$b];
        if ($cp < 0x800) {
            $out .= chr(0xC0 | ($cp >> 6)) . chr(0x80 | ($cp & 0x3F));
        } else {
            $out .= chr(0xE0 | ($cp >> 12)) . chr(0x80 | (($cp >> 6) & 0x3F)) . chr(0x80 | ($cp & 0x3F));
        }
    }
    return $out;
}

function news_cyr_count($text) {
    return preg_match_all('/[А-Яа-яЁё]/u', (string) $text);
}

function news_is_garbled($text) {
    $text = (string) $text;
    $cyr = news_cyr_count($text);
    $bad = substr_count($text, '?') + substr_count($text, "\xEF\xBF\xBD");
    return $cyr < 2 && $bad >= 3;
}

function news_decode_xml($raw, $feedId) {
    if ($raw === null || $raw === '') {
        return $raw;
    }
    $head = substr($raw, 0, 280);
    $declared = '';
    if (preg_match('/encoding=["\']([^"\']+)["\']/i', $head, $m)) {
        $declared = strtolower($m[1]);
    }
    $force1251 = ($feedId === 'gazeta' || strpos($declared, '1251') !== false || strpos($declared, 'cp1251') !== false);
    if ($force1251) {
        if (function_exists('iconv')) {
            $converted = @iconv('WINDOWS-1251', 'UTF-8//IGNORE', $raw);
            if ($converted && news_cyr_count($converted) >= 10) {
                $raw = $converted;
            } else {
                $raw = news_cp1251_to_utf8($raw);
            }
        } elseif (function_exists('mb_convert_encoding')) {
            $converted = @mb_convert_encoding($raw, 'UTF-8', 'Windows-1251');
            $raw = ($converted && news_cyr_count($converted) >= 10) ? $converted : news_cp1251_to_utf8($raw);
        } else {
            $raw = news_cp1251_to_utf8($raw);
        }
    } elseif (news_cyr_count($raw) < 10) {
        $converted = news_cp1251_to_utf8($raw);
        if (news_cyr_count($converted) > news_cyr_count($raw)) {
            $raw = $converted;
        }
    }
    $raw = preg_replace('/encoding=["\'][^"\']+["\']/i', 'encoding="UTF-8"', $raw, 1);
    return $raw;
}

function news_strip($text) {
    $flags = ENT_QUOTES;
    if (defined('ENT_HTML5')) {
        $flags = $flags | ENT_HTML5;
    }
    $text = html_entity_decode(strip_tags((string) $text), $flags, 'UTF-8');
    $text = preg_replace('/\s+/u', ' ', $text);
    return trim($text);
}

function news_tag($block, $name) {
    if (preg_match('/<' . $name . '\\b[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/' . $name . '>/i', $block, $m)) {
        return trim($m[1]);
    }
    if (preg_match('/<' . $name . '\\b[^>]*>([\\s\\S]*?)<\\/' . $name . '>/i', $block, $m)) {
        return trim($m[1]);
    }
    return '';
}

function news_parse_rss($xml, $feed) {
    $items = array();
    if (!$xml) {
        return $items;
    }
    $xml = news_decode_xml($xml, $feed['id']);
    if (!preg_match_all('/<item\\b[^>]*>([\\s\\S]*?)<\\/item>/i', $xml, $blocks)) {
        return $items;
    }
    foreach (array_slice($blocks[1], 0, 24) as $block) {
        $title = news_strip(news_tag($block, 'title'));
        $link = news_strip(news_tag($block, 'link'));
        if ($title === '' || news_is_garbled($title)) {
            continue;
        }
        $pub = news_tag($block, 'pubDate');
        $iso = $pub ? gmdate('Y-m-d\\TH:i:s.000\\Z', strtotime($pub) ?: time()) : null;
        $category = news_strip(news_tag($block, 'category'));
        $summary = news_strip(news_tag($block, 'description'));
        $image = null;
        if (preg_match('/<enclosure[^>]+url=["\\\']([^"\\\']+)["\\\'][^>]*(type=["\\\']image|url=["\\\'][^"\\\']+\\.(jpe?g|png|webp|gif))/i', $block, $m)) {
            $image = $m[1];
        } elseif (preg_match('/<media:(?:content|thumbnail)[^>]+url=["\\\']([^"\\\']+)["\\\']/i', $block, $m)) {
            $image = $m[1];
        } elseif (preg_match('/<img[^>]+src=["\\\']([^"\\\']+)["\\\']/i', $block, $m)) {
            $image = $m[1];
        }
        if (!$image && $feed['id'] === 'ria' && preg_match('/(\\d{7,})\\.html/', $link, $m)) {
            $image = 'https://cdnn21.img.ria.ru/images/sharing/article/' . $m[1] . '.jpg';
        }
        if (!$image && $feed['id'] === 'kommersant' && preg_match('/\\/doc\\/(\\d+)/', $link, $m)) {
            $image = 'https://iv.kommersant.ru/SocialPics/' . $m[1];
        }
        $items[] = array(
            'id' => $link !== '' ? $link : ($feed['id'] . '-' . $title),
            'title' => $title,
            'link' => $link !== '' ? $link : '#',
            'source' => $feed['name'],
            'sourceId' => $feed['id'],
            'color' => $feed['color'],
            'category' => $category !== '' ? $category : null,
            'publishedAt' => $iso,
            'summary' => $summary !== '' ? substr($summary, 0, 280) : $title,
            'image' => $image,
        );
    }
    return $items;
}

function news_fetch_rss($feeds) {
    $errors = array();
    $items = array();
    $bodies = array();
    if (function_exists('curl_multi_init')) {
        $mh = curl_multi_init();
        $handles = array();
        foreach ($feeds as $i => $feed) {
            $ch = curl_init($feed['url']);
            curl_setopt_array($ch, array(
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_TIMEOUT => 3,
                CURLOPT_CONNECTTIMEOUT => 2,
                CURLOPT_USERAGENT => 'OKNO news cache/1.1',
                CURLOPT_HTTPHEADER => array('Accept: application/rss+xml, application/xml, text/xml, */*'),
            ));
            curl_multi_add_handle($mh, $ch);
            $handles[$i] = $ch;
        }
        $running = null;
        do {
            $status = curl_multi_exec($mh, $running);
            if ($running) {
                curl_multi_select($mh, 0.2);
            }
        } while ($running && $status === CURLM_OK);
        foreach ($handles as $i => $ch) {
            $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $body = curl_multi_getcontent($ch);
            if ($body && $code >= 200 && $code < 400) {
                $bodies[$i] = $body;
            } else {
                $errors[] = array('source' => $feeds[$i]['name'], 'error' => 'http ' . $code);
            }
            curl_multi_remove_handle($mh, $ch);
            curl_close($ch);
        }
        curl_multi_close($mh);
    } else {
        foreach ($feeds as $i => $feed) {
            $body = news_http_get($feed['url'], 3);
            if ($body) {
                $bodies[$i] = $body;
            } else {
                $errors[] = array('source' => $feed['name'], 'error' => 'fetch failed');
            }
        }
    }
    foreach ($bodies as $i => $xml) {
        $parsed = news_parse_rss($xml, $feeds[$i]);
        if ($parsed) {
            foreach ($parsed as $item) {
                $items[] = $item;
            }
        } else {
            $errors[] = array('source' => $feeds[$i]['name'], 'error' => 'empty rss');
        }
    }
    if (!$items) {
        return null;
    }
    usort($items, 'news_sort_by_date');
    $seen = array();
    $unique = array();
    foreach ($items as $item) {
        $key = strtolower(substr($item['title'], 0, 100));
        if ($key === '' || isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $unique[] = $item;
        if (count($unique) >= 120) {
            break;
        }
    }
    return array('at' => (int) round(microtime(true) * 1000), 'items' => $unique, 'errors' => $errors);
}

function news_merge($primary, $fallback, $minItems) {
    $items = is_array($primary) ? $primary : array();
    $seen = array();
    foreach ($items as $item) {
        if (!empty($item['title'])) {
            $seen[strtolower($item['title'])] = true;
        }
    }
    if (!is_array($fallback)) {
        return $items;
    }
    foreach ($fallback as $item) {
        if (count($items) >= $minItems) {
            break;
        }
        if (empty($item['title']) || news_is_garbled($item['title'])) {
            continue;
        }
        $key = strtolower($item['title']);
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $items[] = $item;
    }
    return $items;
}

$data = news_read_payload($cacheFile);
$mode = 'EMBEDDED';
$now = time();
$cacheAge = $data && !empty($data['at']) ? ($now - (int) ($data['at'] / 1000)) : PHP_INT_MAX;
$force = isset($_GET['refresh']) && $_GET['refresh'] === '1';

$attempt = @json_decode(@file_get_contents($attemptFile), true);
$lastAttempt = is_array($attempt) && !empty($attempt['at']) ? (int) $attempt['at'] : 0;
$shouldPull = $force || $cacheAge > $STALE_SECONDS;
$canRetry = $force || ($now - $lastAttempt) >= $REMOTE_RETRY_SECONDS;

if ($shouldPull && $canRetry) {
    news_write_payload($attemptFile, array('at' => $now));
    $live = news_fetch_rss($FEEDS);
    if (is_array($live) && !empty($live['items'])) {
        $base = ($data && !empty($data['items'])) ? $data['items'] : array();
        $mergedLive = news_merge($live['items'], $base, max($MIN_ITEMS, count($live['items'])));
        usort($mergedLive, 'news_sort_by_date');
        $live['items'] = array_slice($mergedLive, 0, 120);
        news_write_payload($cacheFile, $live);
        $data = $live;
        $mode = 'RSS';
    }
    if ($mode !== 'RSS' && $cacheEmpty) foreach ($REMOTE_URLS as $url) {
        $body = news_http_get($url, 5);
        $remote = $body ? @json_decode($body, true) : null;
        if (!is_array($remote) || empty($remote['items']) || !is_array($remote['items'])) {
            continue;
        }
        $remoteCount = count($remote['items']);
        $localCount = $data && !empty($data['items']) ? count($data['items']) : 0;
        $remoteAt = !empty($remote['at']) ? (int) $remote['at'] : 0;
        $localAt = $data && !empty($data['at']) ? (int) $data['at'] : 0;
        if ($remoteCount >= 20 && ($remoteAt >= $localAt || $remoteCount >= $localCount)) {
            if (!isset($remote['errors']) || !is_array($remote['errors'])) {
                $remote['errors'] = array();
            }
            news_write_payload($cacheFile, $remote);
            $data = $remote;
            $mode = 'GITHUB';
            break;
        }
    }
}

$items = array();
if (is_array($data) && !empty($data['items']) && is_array($data['items'])) {
    foreach ($data['items'] as $item) {
        if (!empty($item['title']) && !news_is_garbled($item['title'])) {
            $items[] = $item;
        }
    }
    if ($mode !== 'GITHUB' && $mode !== 'RSS') {
        $mode = 'STATIC';
    }
}

if (count($items) < $MIN_ITEMS) {
    $embedded = news_read_payload($embeddedFile);
    $fallback = $embedded && !empty($embedded['items']) ? $embedded['items'] : array();
    $items = news_merge($items, $fallback, $MIN_ITEMS);
    $mode = ($mode === 'STATIC' || $mode === 'GITHUB' || $mode === 'RSS') ? $mode . '+EMBEDDED' : 'EMBEDDED';
}

if (empty($items)) {
    http_response_code(503);
    echo json_encode(array(
        'updatedAt' => gmdate('c'),
        'sources' => array(),
        'items' => array(),
        'errors' => array(array('source' => 'cache', 'error' => 'Le cache du fil est absent ou vide.')),
    ));
    exit;
}

usort($items, 'news_sort_by_date');

$sources = array();
foreach ($items as $item) {
    if (!empty($item['sourceId']) && !isset($sources[$item['sourceId']])) {
        $sources[$item['sourceId']] = array(
            'id' => $item['sourceId'],
            'name' => isset($item['source']) ? $item['source'] : $item['sourceId'],
        );
    }
}

header('X-Cache: ' . $mode);
echo json_encode(array(
    'updatedAt' => isset($data['at']) ? gmdate('c', (int) ($data['at'] / 1000)) : gmdate('c'),
    'sources' => array_values($sources),
    'items' => $items,
    'errors' => isset($data['errors']) && is_array($data['errors']) ? $data['errors'] : array(),
), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
