<?php
/*
 * Emergency-safe news endpoint for restrictive shared PHP hosting.
 *
 * Always answers with the last known dispatches. When the local cache is
 * older than STALE_SECONDS it first tries the seven RSS feeds in parallel
 * (4 s timeout), then the GitHub-main snapshot. A failed refresh never
 * wipes the last good file.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

$MIN_ITEMS = 50;
$STALE_SECONDS = 15 * 60;
$REMOTE_RETRY_SECONDS = 5 * 60;
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
    if (!preg_match('/[А-Яа-яЁё]/u', $xml) && function_exists('iconv')) {
        $converted = @iconv('WINDOWS-1251', 'UTF-8//IGNORE', $xml);
        if ($converted && preg_match('/[А-Яа-яЁё]/u', $converted)) {
            $xml = $converted;
        }
    }
    if (!preg_match_all('/<item\\b[^>]*>([\\s\\S]*?)<\\/item>/i', $xml, $blocks)) {
        return $items;
    }
    foreach (array_slice($blocks[1], 0, 24) as $block) {
        $title = news_strip(news_tag($block, 'title'));
        $link = news_strip(news_tag($block, 'link'));
        if ($title === '') {
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
                CURLOPT_TIMEOUT => 4,
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
            $body = news_http_get($feed['url'], 4);
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
        if (empty($item['title'])) {
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
    if (is_array($live) && count($live['items']) >= 20) {
        news_write_payload($cacheFile, $live);
        $data = $live;
        $mode = 'RSS';
    }
    if ($mode !== 'RSS') foreach ($REMOTE_URLS as $url) {
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
    $items = $data['items'];
    if ($mode !== 'GITHUB') {
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
