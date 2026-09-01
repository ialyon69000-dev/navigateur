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
    if (!is_array($data)) return [];
    // Format actuel : { summary, clients, visits } ; format historique : tableau.
    if (isset($data['visits']) && is_array($data['visits'])) return $data['visits'];
    return $data;
}

function writeVisits($visits) {
    global $VISITS_FILE, $DATA_DIR;
    if (!is_dir($DATA_DIR)) @mkdir($DATA_DIR, 0775, true);
    $tmp = $VISITS_FILE . '.tmp.' . getmypid();
    $payload = buildVisitsFile(is_array($visits) ? $visits : []);
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
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
    return $payload;
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

function sanitizeVisit($body, $ip, $geo, $deviceId = null, $deviceConfirmed = false) {
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
        'deviceId' => isValidDeviceId($deviceId) ? $deviceId : null,
        'deviceConfirmed' => isValidDeviceId($deviceId) ? ($deviceConfirmed === true) : false,
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

// ——— Synthèse des visiteurs ————————————————————————————————————————
// Même logique que server.js : visits.json contient la liste brute plus une
// fiche par client (empreinte recalculée) et un résumé global.

function visitDeviceType($v) {
    $ua = (string)($v['userAgent'] ?? '');
    $hints = $v['clientHints'] ?? [];
    $touch = (int)($v['maxTouchPoints'] ?? 0);
    $isTablet = preg_match('/iPad|Tablet|PlayBook|Silk/i', $ua)
        || (preg_match('/Android/i', $ua) && !preg_match('/Mobile/i', $ua))
        || (($v['platform'] ?? null) === 'MacIntel' && $touch > 1);
    if ($isTablet) return 'tablet';
    if (($hints['mobile'] ?? null) === true || preg_match('/Mobi|iPhone|Android/i', $ua)) return 'mobile';
    return 'desktop';
}

function visitBrowserName($v) {
    $hints = $v['clientHints'] ?? [];
    $brands = array_merge($hints['fullVersionList'] ?? [], $hints['brands'] ?? []);
    foreach ($brands as $b) {
        if (!preg_match('/Not.?A.?Brand/i', $b) && !preg_match('/Chromium/i', $b)) return clampStr($b, 60);
    }
    $ua = (string)($v['userAgent'] ?? '');
    if (preg_match('#Edg/#', $ua)) return 'Edge';
    if (preg_match('#OPR/|Opera#', $ua)) return 'Opera';
    if (preg_match('#YaBrowser#', $ua)) return 'Yandex';
    if (preg_match('#Firefox/#', $ua)) return 'Firefox';
    if (preg_match('#Chrome/#', $ua)) return 'Chrome';
    if (preg_match('#Safari/#', $ua)) return 'Safari';
    return null;
}

function visitOsName($v) {
    $hints = $v['clientHints'] ?? [];
    if (!empty($hints['platform'])) {
        return clampStr($hints['platform'] . (!empty($hints['platformVersion']) ? ' ' . $hints['platformVersion'] : ''), 60);
    }
    return clampStr($v['platform'] ?? platformFromUa($v['userAgent'] ?? ''), 60);
}

// Identité d'appareil : cookie propriétaire (fiable même si l'IP tourne), à
// défaut empreinte SANS IP (approximative : des terminaux identiques se
// confondent). Voir server.js — même logique, mêmes clés.
define('DEVICE_COOKIE', 'okno-device');
define('DEVICE_TTL', 400 * 24 * 60 * 60);

function isValidDeviceId($id) {
    return is_string($id) && preg_match('/^d_[0-9a-f]{32}$/', $id) === 1;
}

function ensureDeviceId() {
    $existing = $_COOKIE[DEVICE_COOKIE] ?? null;
    if (isValidDeviceId($existing)) return [$existing, false];
    $deviceId = 'd_' . bin2hex(random_bytes(16));
    if (!headers_sent()) {
        setcookie(DEVICE_COOKIE, $deviceId, [
            'expires' => time() + DEVICE_TTL,
            'path' => '/',
            'httponly' => true,
            'samesite' => 'Lax',
            'secure' => !empty($_SERVER['HTTPS']),
        ]);
    }
    return [$deviceId, true];
}

function visitFingerprintKey($v) {
    $s = $v['screen'] ?? [];
    $gpu = $v['gpu'] ?? [];
    $parts = implode('|', [
        visitOsName($v) ?? '',
        visitBrowserName($v) ?? '',
        visitDeviceType($v),
        $s['width'] ?? '',
        $s['height'] ?? '',
        $s['colorDepth'] ?? '',
        $s['pixelRatio'] ?? '',
        $v['timezone'] ?? '',
        $v['language'] ?? '',
        $v['hardwareConcurrency'] ?? '',
        $v['deviceMemory'] ?? '',
        $gpu['renderer'] ?? '',
    ]);
    return substr(hash('sha256', $parts), 0, 16);
}

function visitIdentityMode($v, $confirmed = null) {
    $id = $v['deviceId'] ?? null;
    $ok = isValidDeviceId($id) && ($confirmed === null || isset($confirmed[$id]));
    return $ok ? 'device' : 'fingerprint';
}

function visitClientKey($v, $confirmed = null) {
    $id = $v['deviceId'] ?? null;
    if (isValidDeviceId($id) && ($confirmed === null || isset($confirmed[$id]))) {
        return 'c_' . substr($id, 2);
    }
    return 'fp_' . visitFingerprintKey($v);
}

function visitTopOf($counter, $limit = 5) {
    $keys = array_keys($counter);
    usort($keys, function ($a, $b) use ($counter) {
        if ($counter[$b] !== $counter[$a]) return $counter[$b] - $counter[$a];
        return strcmp((string)$a, (string)$b);
    });
    $out = [];
    foreach (array_slice($keys, 0, $limit) as $k) {
        $out[] = ['value' => (string)$k, 'count' => $counter[$k]];
    }
    return $out;
}

function visitBump(&$counter, $key) {
    if ($key === null || $key === '') return;
    $key = (string)$key;
    $counter[$key] = ($counter[$key] ?? 0) + 1;
}

function summarizeVisitClient($visits, $confirmed = null) {
    usort($visits, function ($a, $b) {
        return strtotime($a['recordedAt'] ?? '') <=> strtotime($b['recordedAt'] ?? '');
    });
    $first = $visits[0];
    $last = $visits[count($visits) - 1];
    $geo = $last['geoIp'] ?? [];
    $days = [];
    $referrers = [];
    $languages = [];
    $gps = false;
    foreach ($visits as $v) {
        $d = substr((string)($v['recordedAt'] ?? ''), 0, 10);
        if ($d) $days[$d] = true;
        if (!empty($v['referrer'])) visitBump($referrers, $v['referrer']);
        visitBump($languages, $v['language'] ?? null);
        if (!empty($v['geolocation'])) $gps = true;
    }
    $span = strtotime($last['recordedAt'] ?? '') - strtotime($first['recordedAt'] ?? '');
    $screen = $last['screen'] ?? [];
    $theme = $last['theme'] ?? [];
    $network = $last['network'] ?? [];
    $ids = [];
    foreach ($visits as $v) { if (!empty($v['id'])) $ids[] = $v['id']; }

    $ips = [];
    foreach ($visits as $v) { if (!empty($v['ip'])) $ips[$v['ip']] = true; }
    $mode = visitIdentityMode($last, $confirmed);
    return [
        'clientId' => visitClientKey($last, $confirmed),
        'identity' => $mode,
        'identityNote' => $mode === 'device'
            ? 'cookie propriétaire : un appareil distinct, même si son IP change'
            : 'empreinte sans IP : des appareils identiques peuvent être confondus',
        'visits' => count($visits),
        'distinctDays' => count($days),
        'firstSeen' => $first['recordedAt'] ?? null,
        'lastSeen' => $last['recordedAt'] ?? null,
        'returning' => count($visits) > 1,
        'daysBetweenFirstAndLast' => round($span / 86400, 2),
        'ip' => $last['ip'] ?? null,
        'distinctIps' => count($ips),
        'rotatingIp' => count($ips) > 1,
        'place' => [
            'city' => $geo['city'] ?? null,
            'region' => $geo['region'] ?? null,
            'country' => $geo['country'] ?? null,
            'countryCode' => $geo['countryCode'] ?? null,
            'isp' => $geo['isp'] ?? null,
        ],
        'gpsShared' => $gps,
        'device' => [
            'type' => visitDeviceType($last),
            'os' => visitOsName($last),
            'browser' => visitBrowserName($last),
            'screen' => (!empty($screen['width']) && !empty($screen['height'])) ? ($screen['width'] . '×' . $screen['height']) : null,
            'gpu' => $last['gpu']['renderer'] ?? null,
            'cores' => $last['hardwareConcurrency'] ?? null,
            'memoryGB' => $last['deviceMemory'] ?? null,
            'touch' => (int)($last['maxTouchPoints'] ?? 0) > 0,
        ],
        'preferences' => [
            'language' => $last['language'] ?? null,
            'languages' => $last['languages'] ?? [],
            'timezone' => $last['timezone'] ?? null,
            'colorScheme' => $theme['colorScheme'] ?? null,
            'reducedMotion' => $theme['reducedMotion'] ?? null,
            'keyboardLayout' => $last['keyboard']['layout'] ?? null,
        ],
        'network' => [
            'effectiveType' => $network['effectiveType'] ?? null,
            'downlink' => $network['downlink'] ?? null,
            'rtt' => $network['rtt'] ?? null,
            'saveData' => $network['saveData'] ?? null,
        ],
        'privacy' => [
            'cookiesEnabled' => $last['cookiesEnabled'] ?? null,
            'globalPrivacyControl' => $last['globalPrivacyControl'] ?? null,
            'consent' => ($last['consent'] ?? false) === true,
            'automated' => ($last['webdriver'] ?? false) === true,
        ],
        'referrers' => visitTopOf($referrers, 5),
        'languagesSeen' => visitTopOf($languages, 5),
        'visitIds' => array_slice($ids, -50),
    ];
}

function buildVisitsFile($visits) {
    $list = is_array($visits) ? array_values(array_filter($visits, 'is_array')) : [];
    // Un cookie ne compte que si le navigateur l'a représenté au moins une fois.
    $confirmed = [];
    foreach ($list as $v) {
        if (($v['deviceConfirmed'] ?? false) === true && isValidDeviceId($v['deviceId'] ?? null)) {
            $confirmed[$v['deviceId']] = true;
        }
    }
    $groups = [];
    foreach ($list as $v) {
        $k = visitClientKey($v, $confirmed);
        if (!isset($groups[$k])) $groups[$k] = [];
        $groups[$k][] = $v;
    }
    $clients = [];
    foreach (array_values($groups) as $g) { $clients[] = summarizeVisitClient($g, $confirmed); }
    usort($clients, function ($a, $b) {
        return strtotime($b['lastSeen'] ?? '') <=> strtotime($a['lastSeen'] ?? '');
    });

    $countries = []; $cities = []; $devices = []; $browsers = []; $systems = [];
    $langs = []; $timezones = []; $referrers = []; $hours = [];
    $returning = 0; $gpsShared = 0; $automated = 0;
    $byCookie = 0; $byFingerprint = 0; $rotating = 0;
    foreach ($clients as $c) {
        visitBump($countries, $c['place']['country']);
        visitBump($cities, trim(implode(', ', array_filter([$c['place']['city'], $c['place']['country']]))));
        visitBump($devices, $c['device']['type']);
        visitBump($browsers, $c['device']['browser']);
        visitBump($systems, $c['device']['os']);
        visitBump($langs, $c['preferences']['language']);
        visitBump($timezones, $c['preferences']['timezone']);
        foreach ($c['referrers'] as $r) {
            $referrers[$r['value']] = ($referrers[$r['value']] ?? 0) + $r['count'];
        }
        if ($c['returning']) $returning++;
        if ($c['gpsShared']) $gpsShared++;
        if ($c['privacy']['automated']) $automated++;
        if ($c['identity'] === 'device') $byCookie++; else $byFingerprint++;
        if ($c['rotatingIp']) $rotating++;
    }
    $stamps = []; $days = [];
    foreach ($list as $v) {
        $t = strtotime($v['recordedAt'] ?? '');
        if ($t) {
            $stamps[] = $t;
            visitBump($hours, gmdate('H', $t) . 'h');
        }
        $d = substr((string)($v['recordedAt'] ?? ''), 0, 10);
        if ($d) $days[$d] = true;
    }
    $byHour = visitTopOf($hours, 24);
    usort($byHour, function ($a, $b) { return strcmp($a['value'], $b['value']); });
    $n = count($clients);

    return [
        'generatedAt' => gmdate('c'),
        'summary' => [
            'totalVisits' => count($list),
            'uniqueClients' => $n,
            'returningClients' => $returning,
            'newClients' => $n - $returning,
            'returningRate' => $n ? round($returning / $n, 3) : 0,
            'visitsPerClient' => $n ? round(count($list) / $n, 2) : 0,
            'activeDays' => count($days),
            'firstVisitAt' => $stamps ? gmdate('c', min($stamps)) : null,
            'lastVisitAt' => $stamps ? gmdate('c', max($stamps)) : null,
            'gpsShared' => $gpsShared,
            'automated' => $automated,
            'identifiedByCookie' => $byCookie,
            'identifiedByFingerprint' => $byFingerprint,
            'clientsWithRotatingIp' => $rotating,
            'topCountries' => visitTopOf($countries),
            'topCities' => visitTopOf($cities),
            'topDevices' => visitTopOf($devices),
            'topBrowsers' => visitTopOf($browsers),
            'topSystems' => visitTopOf($systems),
            'topLanguages' => visitTopOf($langs),
            'topTimezones' => visitTopOf($timezones),
            'topReferrers' => visitTopOf($referrers),
            'visitsByHourUTC' => $byHour,
        ],
        'clients' => $clients,
        'visits' => $list,
    ];
}

function readVisitsFile() {
    global $VISITS_FILE;
    if (!file_exists($VISITS_FILE)) return buildVisitsFile([]);
    $data = json_decode(@file_get_contents($VISITS_FILE), true);
    if (is_array($data) && isset($data['visits']) && is_array($data['visits'])) return $data;
    return buildVisitsFile(is_array($data) ? $data : []);
}
