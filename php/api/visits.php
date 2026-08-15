<?php
require __DIR__ . '/_common.php';

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    writeVisits([]);
    jsonResponse(['ok' => true, 'total' => 0]);
}

$visits = readVisits();
jsonResponse(['total' => count($visits), 'file' => 'data/visits.json', 'visits' => $visits]);
