<?php
require __DIR__ . '/_auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    auth_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
$body = auth_read_body();
$login = isset($body['login']) ? trim((string)$body['login']) : '';
$password = isset($body['password']) ? (string)$body['password'] : '';

if ($login === '' || $password === '') {
    auth_json(['ok' => false, 'error' => 'Укажите логин и пароль.'], 400);
}
$len = mb_strlen($login);
if ($len < 3 || $len > 40) {
    auth_json(['ok' => false, 'error' => 'Логин от 3 до 40 знаков.'], 400);
}
if (mb_strlen($password) < 6) {
    auth_json(['ok' => false, 'error' => 'Пароль от 6 знаков.'], 400);
}

$users = auth_read_users();
foreach ($users as $u) {
    if (isset($u['login']) && mb_strtolower($u['login']) === mb_strtolower($login)) {
        auth_json(['ok' => false, 'error' => 'Этот логин уже занят.'], 409);
    }
}

$salt = $login . '-' . base_convert((string)time(), 10, 36);
$hash = auth_sha256($password, $salt);
$newUser = [
    'id' => 'u_' . base_convert((string)time(), 10, 36) . '_' . substr(bin2hex(random_bytes(2)), 0, 4),
    'login' => $login,
    'hash' => $hash,
    'salt' => $salt,
    'createdAt' => gmdate('c'),
    'role' => 'reader',
];
$users[] = $newUser;
auth_write_json($AUTH_USERS_FILE, $users);

auth_json(['ok' => true, 'user' => auth_public_user($newUser)], 201);
