<?php
/**
 * health.php — GET /api/health
 *
 * Sonde de déploiement. Sert aussi à diagnostiquer le problème le plus courant
 * sur un hébergement gratuit : le dossier data/ non inscriptible, qui fait
 * échouer l'ouverture de session (le login « marche » puis renvoie sur la page
 * de connexion).
 */
require __DIR__ . '/auth/_auth.php';

$writable = auth_data_dir_writable();
$users = auth_read_users();

auth_json([
    'ok' => $writable,
    'time' => gmdate('c'),
    'php' => PHP_VERSION,
    'data' => [
        'dir' => $writable ? 'writable' : 'readonly',
        'hint' => $writable ? null : 'chmod 777 data/ et chmod 666 data/*.json',
        'accounts' => count($users),
    ],
]);
