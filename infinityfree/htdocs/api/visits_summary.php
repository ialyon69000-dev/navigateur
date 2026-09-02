<?php
// Téléchargement de la synthèse (fichier séparé du journal brut).
require __DIR__ . '/_common.php';

$file = readSummaryFile();
header('Content-Disposition: attachment; filename=visits_summary.json');
jsonResponse($file);
