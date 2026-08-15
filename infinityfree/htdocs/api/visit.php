<?php
require __DIR__ . '/_common.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jsonResponse(['error' => 'Method not allowed'], 405);
}

$ip = clientIp();
$now = microtime(true) * 1000;
$cooldownFile = sys_get_temp_dir() . '/visit_cooldown_' . md5($ip) . '.txt';
$last = 0;
if (file_exists($cooldownFile)) $last = (int)@file_get_contents($cooldownFile);
$nowMs = (int)(microtime(true)*1000);
if ($last && ($nowMs - $last) < 20000) {
    jsonResponse(['error' => 'Patientez quelques secondes avant un nouvel enregistrement.'], 429);
}
@file_put_contents($cooldownFile, (string)$nowMs);

$raw = file_get_contents('php://input');
$body = json_decode($raw, true);
if (!is_array($body)) $body = [];

$geo = geoFromIp($ip);
$visit = sanitizeVisit($body, $ip, $geo);

$visits = readVisits();
array_unshift($visits, $visit);
$visits = array_slice($visits, 0, $MAX_VISITS);
writeVisits($visits);

jsonResponse(['ok' => true, 'visit' => $visit, 'total' => min(count($visits), $MAX_VISITS)], 201);
