<?php
$DATA_DIR = __DIR__ . '/../data';
$VISITS_FILE = $DATA_DIR . '/visits.json';
$NEWS_CACHE_FILE = $DATA_DIR . '/news_cache.json';
$MAX_VISITS = 800;
$NEWS_TTL_MS = 5 * 60 * 1000;
$VISIT_COOLDOWN_MS = 20 * 1000;

if (!is_dir($DATA_DIR)) {
    @mkdir($DATA_DIR, 0775, true);
}
if (!file_exists($VISITS_FILE)) {
    @file_put_contents($VISITS_FILE, "[]\n");
}

function clientIp() {
    if (!empty($_SERVER['HTTP_CF_CONNECTING_IP'])) return trim($_SERVER['HTTP_CF_CONNECTING_IP']);
    if (!empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $parts = explode(',', $_SERVER['HTTP_X_FORWARDED_FOR']);
        return trim($parts[0]);
    }
    if (!empty($_SERVER['HTTP_X_REAL_IP'])) return trim($_SERVER['HTTP_X_REAL_IP']);
    $ip = $_SERVER['REMOTE_ADDR'] ?? '';
    if (strpos($ip, '::ffff:') === 0) $ip = substr($ip, 7);
    if ($ip === '::1') $ip = '127.0.0.1';
    return $ip;
}

function isPrivateIp($ip) {
    if (!$ip) return true;
    if ($ip === '127.0.0.1' || $ip === '::1') return true;
    if (strpos($ip, '10.') === 0) return true;
    if (strpos($ip, '192.168.') === 0) return true;
    if (preg_match('/^172\\.(1[6-9]|2\\d|3[0-1])\\./', $ip)) return true;
    return false;
}

function httpFetch($url, $timeout = 12) {
    // Prefer cURL
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 6,
            CURLOPT_USERAGENT => 'EmpreintePedagogique/1.0 (educational news reader; PHP port for InfinityFree)',
            CURLOPT_HTTPHEADER => ['Accept: application/rss+xml, application/xml, text/xml, */*'],
            CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $body = curl_exec($ch);
        $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $ctype = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) throw new Exception("curl error: $err");
        if ($code >= 400) throw new Exception("http $code");
        return [$body, $ctype];
    } else {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "User-Agent: EmpreintePedagogique/1.0\r\nAccept: application/rss+xml, application/xml, text/xml, */*\r\n",
                'timeout' => $timeout,
            ]
        ]);
        $body = @file_get_contents($url, false, $ctx);
        if ($body === false) throw new Exception("fetch failed $url");
        $ctype = null;
        if (isset($http_response_header)) {
            foreach ($http_response_header as $h) {
                if (stripos($h, 'content-type:') === 0) $ctype = trim(substr($h, 13));
            }
        }
        return [$body, $ctype];
    }
}

function geoFromIp($ip) {
    if (isPrivateIp($ip)) {
        return [
            'source' => 'local',
            'city' => 'réseau local',
            'region' => null,
            'country' => 'Local',
            'countryCode' => null,
            'lat' => null,
            'lon' => null,
            'isp' => 'loopback / LAN',
            'timezone' => null,
        ];
    }
    try {
        $url = 'https://ipwho.is/' . urlencode($ip) . '?fields=success,message,city,region,country,country_code,latitude,longitude,connection,timezone';
        list($body, $ctype) = httpFetch($url, 5);
        $j = json_decode($body, true);
        if (!$j || empty($j['success'])) throw new Exception($j['message'] ?? 'geo fail');
        return [
            'source' => 'ipwho.is',
            'city' => $j['city'] ?? null,
            'region' => $j['region'] ?? null,
            'country' => $j['country'] ?? null,
            'countryCode' => $j['country_code'] ?? null,
            'lat' => isset($j['latitude']) && is_numeric($j['latitude']) ? $j['latitude'] : null,
            'lon' => isset($j['longitude']) && is_numeric($j['longitude']) ? $j['longitude'] : null,
            'isp' => $j['connection']['isp'] ?? $j['connection']['org'] ?? null,
            'timezone' => $j['timezone']['id'] ?? $j['timezone'] ?? null,
        ];
    } catch (Exception $e) {
        return [
            'source' => 'unavailable',
            'city' => null,
            'region' => null,
            'country' => null,
            'countryCode' => null,
            'lat' => null,
            'lon' => null,
            'isp' => null,
            'timezone' => null,
            'error' => $e->getMessage(),
        ];
    }
}

function clampStr($v, $max) {
    if ($v === null) return null;
    $s = trim((string)$v);
    if ($s === '') return null;
    if (mb_strlen($s) > $max) return mb_substr($s, 0, $max);
    return $s;
}

function jsonResponse($data, $code = 200) {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function readVisits() {
    global $VISITS_FILE, $DATA_DIR;
    if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0775, true);
    if (!file_exists($VISITS_FILE)) return [];
    $raw = @file_get_contents($VISITS_FILE);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function writeVisits($visits) {
    global $VISITS_FILE, $DATA_DIR;
    if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0775, true);
    $tmp = $VISITS_FILE . '.tmp.' . getmypid();
    $json = json_encode($visits, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
    // flock
    $fh = fopen($tmp, 'w');
    if ($fh) {
        if (flock($fh, LOCK_EX)) {
            fwrite($fh, $json);
            fflush($fh);
            flock($fh, LOCK_UN);
        }
        fclose($fh);
        @rename($tmp, $VISITS_FILE);
    } else {
        file_put_contents($VISITS_FILE, $json);
    }
}

function parseAcceptLanguage($header) {
    if (!$header) return [];
    $parts = explode(',', $header);
    $out = [];
    foreach ($parts as $p) {
        $lang = trim(explode(';', $p)[0]);
        if ($lang) $out[] = $lang;
        if (count($out) >= 8) break;
    }
    return $out;
}

function platformFromUa($ua) {
    $s = (string)$ua;
    if (preg_match('/Windows NT 10/i', $s)) return 'Windows 10/11';
    if (preg_match('/Windows/i', $s)) return 'Windows';
    if (preg_match('/Mac OS X/i', $s)) return 'macOS';
    if (preg_match('/Android/i', $s)) return 'Android';
    if (preg_match('/iPhone|iPad/i', $s)) return 'iOS';
    if (preg_match('/Linux/i', $s)) return 'Linux';
    return null;
}

function sanitizeHints($raw) {
    $h = is_array($raw) ? $raw : [];
    $brands = [];
    if (!empty($h['brands']) && is_array($h['brands'])) {
        foreach ($h['brands'] as $x) {
            $c = clampStr($x, 60);
            if ($c) $brands[] = $c;
            if (count($brands) >= 8) break;
        }
    }
    $full = [];
    if (!empty($h['fullVersionList']) && is_array($h['fullVersionList'])) {
        foreach ($h['fullVersionList'] as $x) {
            $c = clampStr($x, 80);
            if ($c) $full[] = $c;
            if (count($full) >= 8) break;
        }
    }
    return [
        'available' => !empty($h['available']),
        'mobile' => isset($h['mobile']) ? (bool)$h['mobile'] : null,
        'platform' => clampStr($h['platform'] ?? null, 40),
        'platformVersion' => clampStr($h['platformVersion'] ?? null, 40),
        'architecture' => clampStr($h['architecture'] ?? null, 20),
        'bitness' => clampStr($h['bitness'] ?? null, 8),
        'model' => clampStr($h['model'] ?? null, 60),
        'uaFullVersion' => clampStr($h['uaFullVersion'] ?? null, 40),
        'brands' => $brands,
        'fullVersionList' => $full,
        'wow64' => isset($h['wow64']) ? (bool)$h['wow64'] : null,
    ];
}

function sanitizeVisit($body, $ip, $geo) {
    $client = is_array($body) ? $body : [];
    $languages = [];
    if (!empty($client['languages']) && is_array($client['languages'])) {
        foreach ($client['languages'] as $x) {
            $c = clampStr($x, 20);
            if ($c) $languages[] = $c;
            if (count($languages) >= 8) break;
        }
    }
    $screen = $client['screen'] ?? [];
    $keyboard = $client['keyboard'] ?? [];
    $geoGps = $client['geolocation'] ?? [];
    $theme = $client['theme'] ?? [];
    $network = $client['network'] ?? [];
    $gpu = $client['gpu'] ?? [];
    $voices = $client['voices'] ?? [];
    $intl = $client['intl'] ?? [];
    $storage = $client['storage'] ?? [];
    $fromHeader = parseAcceptLanguage($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '');

    $lang = clampStr($client['language'] ?? null, 20);
    if (!$lang && !empty($fromHeader)) $lang = $fromHeader[0];

    $geolocation = null;
    if (isset($geoGps['lat'], $geoGps['lon']) && is_numeric($geoGps['lat']) && is_numeric($geoGps['lon'])) {
        $geolocation = [
            'lat' => round((float)$geoGps['lat'], 5),
            'lon' => round((float)$geoGps['lon'], 5),
            'accuracy' => isset($geoGps['accuracy']) && is_numeric($geoGps['accuracy']) ? round($geoGps['accuracy']) : null,
            'source' => 'navigator.geolocation',
        ];
    }

    return [
        'id' => 'v_' . base_convert((string)time(), 10, 36) . '_' . substr(bin2hex(random_bytes(4)), 0, 6),
        'recordedAt' => gmdate('c'),
        'ip' => $ip,
        'geoIp' => $geo,
        'geolocation' => $geolocation,
        'language' => $lang,
        'languages' => !empty($languages) ? $languages : $fromHeader,
        'keyboard' => [
            'layout' => clampStr($keyboard['layout'] ?? null, 80),
            'sample' => clampStr($keyboard['sample'] ?? null, 20),
            'api' => !empty($keyboard['api']),
        ],
        'screen' => [
            'width' => isset($screen['width']) && is_numeric($screen['width']) ? round($screen['width']) : null,
            'height' => isset($screen['height']) && is_numeric($screen['height']) ? round($screen['height']) : null,
            'availWidth' => isset($screen['availWidth']) && is_numeric($screen['availWidth']) ? round($screen['availWidth']) : null,
            'availHeight' => isset($screen['availHeight']) && is_numeric($screen['availHeight']) ? round($screen['availHeight']) : null,
            'colorDepth' => isset($screen['colorDepth']) && is_numeric($screen['colorDepth']) ? (int)$screen['colorDepth'] : null,
            'pixelRatio' => isset($screen['pixelRatio']) && is_numeric($screen['pixelRatio']) ? round((float)$screen['pixelRatio'], 2) : null,
            'viewportW' => isset($screen['viewportW']) && is_numeric($screen['viewportW']) ? round($screen['viewportW']) : null,
            'viewportH' => isset($screen['viewportH']) && is_numeric($screen['viewportH']) ? round($screen['viewportH']) : null,
            'outerW' => isset($screen['outerW']) && is_numeric($screen['outerW']) ? round($screen['outerW']) : null,
            'outerH' => isset($screen['outerH']) && is_numeric($screen['outerH']) ? round($screen['outerH']) : null,
            'orientation' => clampStr($screen['orientation'] ?? null, 40),
        ],
        'timezone' => clampStr($client['timezone'] ?? null, 60) ?: ($geo['timezone'] ?? null),
        'platform' => clampStr($client['platform'] ?? null, 80) ?: platformFromUa($client['userAgent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? '')),
        'userAgent' => clampStr($client['userAgent'] ?? ($_SERVER['HTTP_USER_AGENT'] ?? ''), 350),
        'hardwareConcurrency' => isset($client['hardwareConcurrency']) && is_numeric($client['hardwareConcurrency']) ? (int)$client['hardwareConcurrency'] : null,
        'deviceMemory' => isset($client['deviceMemory']) && is_numeric($client['deviceMemory']) ? (float)$client['deviceMemory'] : null,
        'maxTouchPoints' => isset($client['maxTouchPoints']) && is_numeric($client['maxTouchPoints']) ? (int)$client['maxTouchPoints'] : null,
        'referrer' => clampStr($client['referrer'] ?? null, 300),
        'acceptLanguage' => clampStr($_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? '', 160),
        'cookiesEnabled' => isset($client['cookiesEnabled']) ? (bool)$client['cookiesEnabled'] : null,
        'globalPrivacyControl' => isset($client['globalPrivacyControl']) ? (bool)$client['globalPrivacyControl'] : null,
        'pdfViewerEnabled' => isset($client['pdfViewerEnabled']) ? (bool)$client['pdfViewerEnabled'] : null,
        'webdriver' => isset($client['webdriver']) ? (bool)$client['webdriver'] : null,
        'clientHints' => sanitizeHints($client['clientHints'] ?? []),
        'theme' => [
            'colorScheme' => clampStr($theme['colorScheme'] ?? null, 20),
            'reducedMotion' => isset($theme['reducedMotion']) ? (bool)$theme['reducedMotion'] : null,
            'pointer' => clampStr($theme['pointer'] ?? null, 20),
            'hover' => isset($theme['hover']) ? (bool)$theme['hover'] : null,
            'colorGamut' => clampStr($theme['colorGamut'] ?? null, 12),
        ],
        'network' => [
            'type' => clampStr($network['type'] ?? null, 20),
            'effectiveType' => clampStr($network['effectiveType'] ?? null, 12),
            'downlink' => isset($network['downlink']) && is_numeric($network['downlink']) ? round((float)$network['downlink'], 2) : null,
            'rtt' => isset($network['rtt']) && is_numeric($network['rtt']) ? round($network['rtt']) : null,
            'saveData' => isset($network['saveData']) ? (bool)$network['saveData'] : null,
        ],
        'gpu' => [
            'vendor' => clampStr($gpu['vendor'] ?? null, 120),
            'renderer' => clampStr($gpu['renderer'] ?? null, 180),
        ],
        'voices' => [
            'count' => isset($voices['count']) && is_numeric($voices['count']) ? (int)$voices['count'] : null,
            'langs' => array_slice(array_values(array_filter(array_map(function($x){ return clampStr($x,20); }, $voices['langs'] ?? []))), 0, 20),
            'names' => array_slice(array_values(array_filter(array_map(function($x){ return clampStr($x,80); }, $voices['names'] ?? []))), 0, 16),
        ],
        'intl' => [
            'locale' => clampStr($intl['locale'] ?? null, 30),
            'calendar' => clampStr($intl['calendar'] ?? null, 30),
            'numberingSystem' => clampStr($intl['numberingSystem'] ?? null, 20),
            'timeZone' => clampStr($intl['timeZone'] ?? null, 60),
        ],
        'storage' => [
            'quotaMB' => isset($storage['quotaMB']) && is_numeric($storage['quotaMB']) ? (int)$storage['quotaMB'] : null,
            'usageMB' => isset($storage['usageMB']) && is_numeric($storage['usageMB']) ? (int)$storage['usageMB'] : null,
        ],
        'consent' => ($client['consent'] ?? false) === true,
    ];
}
