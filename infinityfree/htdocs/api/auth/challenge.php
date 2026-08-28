<?php
/**
 * challenge.php — GET /api/auth/challenge?login=xxx
 *
 * Renvoie le sel du compte pour que le navigateur puisse calculer
 * sha256(mot_de_passe + sel) sans jamais envoyer le mot de passe.
 *
 * Un login inconnu reçoit un sel de substitution déterministe : la réponse ne
 * permet donc pas de savoir si un compte existe (pas d'énumération).
 */
require __DIR__ . '/_auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    auth_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$login = isset($_GET['login']) ? trim((string)$_GET['login']) : '';
if ($login === '' || auth_strlen($login) > 40) {
    auth_json(['ok' => true, 'salt' => auth_decoy_salt($login), 'scheme' => $AUTH_SCHEME]);
}

$users = auth_read_users();
list($idx, $user) = auth_find_user($users, $login);

if ($idx === null || !auth_salt_is_usable(isset($user['salt']) ? (string)$user['salt'] : '')) {
    auth_json(['ok' => true, 'salt' => auth_decoy_salt($login), 'scheme' => $AUTH_SCHEME]);
}

auth_json(['ok' => true, 'salt' => (string)$user['salt'], 'scheme' => $AUTH_SCHEME]);
