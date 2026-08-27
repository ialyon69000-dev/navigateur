<?php
require __DIR__ . '/_auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    auth_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
$body = auth_read_body();
$login = isset($body['login']) ? trim((string)$body['login']) : '';
$password = isset($body['password']) ? (string)$body['password'] : '';

if ($login === '' || $password === '') {
    auth_json(['ok' => false, 'error' => 'Заполните логин и пароль.'], 400);
}

$users = auth_read_users();
$found = null;
foreach ($users as $u) {
    if (isset($u['login']) && mb_strtolower($u['login']) === mb_strtolower($login)) {
        $found = $u;
        break;
    }
}
if (!$found) {
    auth_json(['ok' => false, 'error' => 'Неверный логин или пароль.'], 401);
}
$salt = isset($found['salt']) ? $found['salt'] : '';
if (auth_sha256($password, $salt) !== ($found['hash'] ?? '')) {
    auth_json(['ok' => false, 'error' => 'Неверный логин или пароль.'], 401);
}

$sessions = auth_read_sessions();
$sid = auth_gen_session_id();
$sessions[$sid] = ['userId' => $found['id'], 'created' => time() * 1000];
auth_write_sessions($sessions);
auth_set_cookie($sid);

auth_json(['ok' => true, 'user' => auth_public_user($found)]);
