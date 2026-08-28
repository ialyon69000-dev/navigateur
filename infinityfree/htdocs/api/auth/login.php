<?php
require __DIR__ . '/_auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    auth_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
$body = auth_read_body();
auth_reject_cleartext($body);

$login = isset($body['login']) ? trim((string)$body['login']) : '';
$hash = isset($body['hash']) ? strtolower(trim((string)$body['hash'])) : '';

if ($login === '' || $hash === '') {
    auth_json(['ok' => false, 'error' => 'Заполните логин и пароль.'], 400);
}
if (!auth_valid_client_hash($hash)) {
    auth_json([
        'ok' => false,
        'error' => 'Неверный формат данных входа. Обновите страницу (Ctrl+F5).',
        'reason' => 'bad-hash-format',
    ], 400);
}

$users = auth_read_users();
list($idx, $found) = auth_find_user($users, $login);
if ($idx === null) {
    auth_json(['ok' => false, 'error' => 'Неверный логин или пароль.'], 401);
}

$salt = isset($found['salt']) ? (string)$found['salt'] : '';
$stored = isset($found['hash']) ? (string)$found['hash'] : '';
$expected = auth_hash_from_client($hash, $salt);
$migrated = false;

if (hash_equals($expected, $stored)) {
    // Schéma courant (H2) : rien à faire.
} elseif (hash_equals($hash, $stored)) {
    // Compte de l'ancien schéma (H1 stocké tel quel) : le navigateur vient de
    // prouver qu'il connaît le mot de passe, on monte le compte au schéma 2.
    $users[$idx]['hash'] = $expected;
    $users[$idx]['scheme'] = $AUTH_SCHEME;
    $users[$idx]['migratedAt'] = gmdate('c');
    if (!auth_write_json($AUTH_USERS_FILE, $users)) {
        auth_json(['ok' => false, 'error' => auth_storage_error()], 500);
    }
    $migrated = true;
} else {
    auth_json(['ok' => false, 'error' => 'Неверный логин или пароль.'], 401);
}

$sessions = auth_read_sessions();
$sid = auth_gen_session_id();
$sessions[$sid] = ['userId' => $found['id'], 'created' => time() * 1000];
if (!auth_write_sessions($sessions)) {
    auth_json(['ok' => false, 'error' => auth_storage_error()], 500);
}
auth_set_cookie($sid);

auth_json([
    'ok' => true,
    'user' => auth_public_user($found),
    'migrated' => $migrated,
]);
