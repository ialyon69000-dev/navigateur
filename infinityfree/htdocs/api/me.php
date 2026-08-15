<?php
require __DIR__ . '/_common.php';
$ip = clientIp();
$geo = geoFromIp($ip);
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('Content-Type: application/json; charset=utf-8');
echo json_encode([
    'ip' => $ip,
    'geo' => $geo,
    'headers' => [
        'userAgent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
        'acceptLanguage' => $_SERVER['HTTP_ACCEPT_LANGUAGE'] ?? null,
        'accept' => $_SERVER['HTTP_ACCEPT'] ?? null,
        'referer' => $_SERVER['HTTP_REFERER'] ?? null,
    ],
    'serverTime' => gmdate('c'),
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
