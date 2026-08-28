<?php
require __DIR__ . '/_auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    auth_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
$body = auth_read_body();
auth_reject_cleartext($body);

$login = isset($body['login']) ? trim((string)$body['login']) : '';
$hash = isset($body['hash']) ? strtolower(trim((string)$body['hash'])) : '';
$salt = isset($body['salt']) ? trim((string)$body['salt']) : '';

if ($login === '' || $hash === '' || $salt === '') {
    auth_json(['ok' => false, 'error' => 'Укажите логин и пароль.'], 400);
}
if (!auth_valid_client_hash($hash)) {
    auth_json([
        'ok' => false,
        'error' => 'Неверный формат данных регистрации. Обновите страницу (Ctrl+F5).',
        'reason' => 'bad-hash-format',
    ], 400);
}
if (!auth_valid_salt($salt)) {
    auth_json(['ok' => false, 'error' => 'Неверный формат соли.'], 400);
}

$len = auth_strlen($login);
if ($len < 3 || $len > 40) {
    auth_json(['ok' => false, 'error' => 'Логин от 3 до 40 знаков.'], 400);
}

$users = auth_read_users();
list($existingIdx, $existing) = auth_find_user($users, $login);
if ($existingIdx !== null) {
    auth_json(['ok' => false, 'error' => 'Этот логин уже занят.'], 409);
}

$newUser = [
    'id' => 'u_' . base_convert((string)time(), 10, 36) . '_' . substr(bin2hex(random_bytes(2)), 0, 4),
    'login' => $login,
    'hash' => auth_hash_from_client($hash, $salt),
    'salt' => $salt,
    'scheme' => $AUTH_SCHEME,
    'createdAt' => gmdate('c'),
    'role' => 'reader',
];
$users[] = $newUser;
if (!auth_write_json($AUTH_USERS_FILE, $users)) {
    auth_json(['ok' => false, 'error' => auth_storage_error()], 500);
}

auth_json(['ok' => true, 'user' => auth_public_user($newUser)], 201);
