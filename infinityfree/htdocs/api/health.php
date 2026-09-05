<?php
/**
 * health.php — GET /api/health
 *
 * Sonde de déploiement. Sert aussi à diagnostiquer le problème le plus courant
 * sur un hébergement gratuit : le dossier data/ non inscriptible, qui fait
 * échouer l'ouverture de session (le login « marche » puis renvoie sur la page
 * de connexion).
 *
 * Deux niveaux de lecture, parce que cette URL est publique :
 *   • appelant anonyme (la surveillance, un scanner, n'importe qui) : `ok`,
 *     l'horodatage et l'état du dossier data/ — rien qu'on ne devine déjà en
 *     voyant le site tourner ou casser ;
 *   • rédaction connectée (session valide + rôle administrateur, les mêmes
 *     droits que pour écrire une dépêche) : en plus la version de PHP et le
 *     nombre de comptes, pour la vérification manuelle qui suit un déploiement.
 *
 * Pourquoi ces deux champs sont réservés : « 8.1.2 » suffit à un attaquant pour
 * cibler les failles connues de cette pile, et `accounts` donne la taille de la
 * base. Les obtenir reste trivial pour l'équipe — ouvrir l'URL dans le
 * navigateur, connecté en rédaction, suffit.
 */
require __DIR__ . '/auth/_auth.php';
require_once __DIR__ . '/_content.php'; // content_is_admin() : un seul sens de « qui est rédaction »

$writable = auth_data_dir_writable();

$payload = [
    'ok' => $writable,
    'time' => gmdate('c'),
    'data' => [
        'dir' => $writable ? 'writable' : 'readonly',
        'hint' => $writable ? null : 'chmod 777 data/ et chmod 666 data/*.json',
    ],
];

if (content_is_admin(auth_current_user())) {
    $payload['php'] = PHP_VERSION;
    $payload['data']['accounts'] = count(auth_read_users());
}

auth_json($payload);
