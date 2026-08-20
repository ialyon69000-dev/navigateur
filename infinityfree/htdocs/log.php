<?php
/**
 * log.php — Simulation de phishing : journalisation des soumissions
 * ----------------------------------------------------------------
 * Enregistre l'adresse IP, la date/heure et la source (facebook|vk)
 * quand un participant soumet le faux formulaire de connexion.
 * NE COLLECTE JAMAIS le mot de passe ni l'identifiant saisi.
 *
 * Endpoints :
 *   GET  log.php?action=count&source=facebook        -> {"count": N}
 *   POST log.php (event=submit&source=facebook)      -> {"ok":true,"ip":"...","count":N}
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json; charset=utf-8');

// Pré-vol CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// Liste blanche des sources (évite l'injection dans le nom du fichier de log)
$allowedSources = ['facebook', 'vk'];
$source = isset($_REQUEST['source']) ? trim((string)$_REQUEST['source']) : '';
if (!in_array($source, $allowedSources, true)) {
    $source = 'inconnu';
}

function logFile(string $source): string {
    return __DIR__ . '/logs/' . $source . '.csv';
}

function countSubmissions(string $source): int {
    $file = logFile($source);
    if (!is_file($file)) {
        return 0;
    }
    $lines = file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $n = count($lines);
    return $n > 0 ? $n - 1 : 0; // -1 pour la ligne d'en-tête
}

function getClientIp(): string {
    // Ordre : en-têtes de proxy d'abord, puis IP directe.
    $keys = ['HTTP_X_FORWARDED_FOR', 'HTTP_CLIENT_IP', 'REMOTE_ADDR'];
    foreach ($keys as $k) {
        if (!empty($_SERVER[$k])) {
            foreach (explode(',', (string)$_SERVER[$k]) as $candidate) {
                $candidate = trim($candidate);
                if (filter_var($candidate, FILTER_VALIDATE_IP)) {
                    return $candidate;
                }
            }
        }
    }
    return 'inconnue';
}

// --- GET : renvoie le compteur global ---
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['action']) && $_GET['action'] === 'count') {
        echo json_encode(['count' => countSubmissions($source)]);
    } else {
        http_response_code(400);
        echo json_encode(['error' => 'action inconnue']);
    }
    exit;
}

// --- POST : journalise une soumission ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $event = isset($_POST['event']) ? (string)$_POST['event'] : '';

    if ($event !== 'submit') {
        http_response_code(400);
        echo json_encode(['error' => 'événement inconnu']);
        exit;
    }

    $dir = __DIR__ . '/logs';
    if (!is_dir($dir)) {
        @mkdir($dir, 0775, true);
    }

    $file = logFile($source);
    $isNew = !is_file($file);

    $fp = @fopen($file, 'a');
    if ($fp === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'impossible d\'écrire dans ' . $dir . ' — vérifiez les droits en écriture']);
        exit;
    }

    if ($isNew) {
        // Séparateur ";" pour une ouverture propre dans Excel (FR/BE).
        fputcsv($fp, ['date_heure', 'ip', 'source', 'user_agent'], ';');
    }

    $ip   = getClientIp();
    $time = date('Y-m-d H:i:s');
    $ua   = isset($_SERVER['HTTP_USER_AGENT']) ? (string)$_SERVER['HTTP_USER_AGENT'] : '';

    fputcsv($fp, [$time, $ip, $source, $ua], ';');
    fclose($fp);

    echo json_encode([
        'ok'    => true,
        'ip'    => $ip,
        'count' => countSubmissions($source),
    ]);
    exit;
}

http_response_code(405);
echo json_encode(['error' => 'méthode non autorisée']);
