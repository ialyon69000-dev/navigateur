<?php
/*
 * Emergency-safe news endpoint for restrictive shared PHP hosting.
 *
 * This file intentionally has no XML, cURL, mbstring or modern-PHP
 * dependency. It must keep returning the last saved dispatches even on hosts
 * where outbound RSS connections or optional PHP extensions are unavailable.
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');

$cacheFile = dirname(__FILE__) . '/../data/news_cache.json';
$raw = @file_get_contents($cacheFile);
$data = @json_decode($raw, true);

if (!is_array($data) || empty($data['items']) || !is_array($data['items'])) {
    http_response_code(503);
    echo json_encode(array(
        'updatedAt' => gmdate('c'),
        'sources' => array(),
        'items' => array(),
        'errors' => array(array('source' => 'cache', 'error' => 'Le cache du fil est absent ou vide.'))
    ));
    exit;
}

$sources = array();
foreach ($data['items'] as $item) {
    if (!empty($item['sourceId']) && !isset($sources[$item['sourceId']])) {
        $sources[$item['sourceId']] = array(
            'id' => $item['sourceId'],
            'name' => isset($item['source']) ? $item['source'] : $item['sourceId']
        );
    }
}

header('X-Cache: STATIC');
echo json_encode(array(
    'updatedAt' => isset($data['at']) ? gmdate('c', (int) ($data['at'] / 1000)) : gmdate('c'),
    'sources' => array_values($sources),
    'items' => $data['items'],
    'errors' => isset($data['errors']) && is_array($data['errors']) ? $data['errors'] : array()
), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
