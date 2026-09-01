<?php
require __DIR__ . '/_common.php';

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    writeVisits([]);
    jsonResponse(['ok' => true, 'total' => 0]);
}

$file = readVisitsFile();

// ?summary=1 : uniquement la synthèse (sans le journal brut).
if (!empty($_GET['summary'])) {
    jsonResponse([
        'generatedAt' => $file['generatedAt'],
        'summary' => $file['summary'],
        'clients' => $file['clients'],
    ]);
}

jsonResponse([
    'total' => count($file['visits']),
    'file' => 'data/visits.json',
    'generatedAt' => $file['generatedAt'],
    'summary' => $file['summary'],
    'clients' => $file['clients'],
    'visits' => $file['visits'],
]);
