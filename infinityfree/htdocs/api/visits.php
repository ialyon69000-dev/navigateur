<?php
require __DIR__ . '/_common.php';

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    writeVisits([]);
    jsonResponse(['ok' => true, 'total' => 0]);
}

$file = readSummaryFile();

// ?summary=1 : uniquement la synthèse (sans le journal brut).
if (!empty($_GET['summary'])) {
    jsonResponse([
        'file' => 'data/visits_summary.json',
        'source' => 'data/visits.json',
        'generatedAt' => $file['generatedAt'],
        'summary' => $file['summary'],
        'clients' => $file['clients'],
    ]);
}

$visits = readVisits();
jsonResponse([
    'total' => count($visits),
    'file' => 'data/visits.json',
    'summaryFile' => 'data/visits_summary.json',
    'generatedAt' => $file['generatedAt'],
    'summary' => $file['summary'],
    'clients' => $file['clients'],
    'visits' => $visits,
]);
