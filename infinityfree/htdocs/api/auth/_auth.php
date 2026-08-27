<?php
/**
 * _auth.php — logique d'authentification partagée (portée depuis server.js).
 *
 * Même mécanisme que la version Node : un cookie « okno-session » contient un
 * identifiant de session aléatoire ; les sessions sont stockées dans
 * data/sessions.json ({ sid: { userId, created } }), les comptes dans
 * data/users.json. Le mot de passe n'est jamais stocké en clair (sha256 + sel).
 */

$AUTH_DATA_DIR = __DIR__ . '/../../data';
$AUTH_USERS_FILE = $AUTH_DATA_DIR . '/users.json';
$AUTH_SESSIONS_FILE = $AUTH_DATA_DIR . '/sessions.json';
$AUTH_COOKIE = 'okno-session';
$AUTH_TTL_S = 24 * 60 * 60; // 24 h

function auth_json_headers() {
    header('Content-Type: application/json; charset=utf-8');
    header('Referrer-Policy: no-referrer');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-store, max-age=0');
}

function auth_json($data, $code = 200) {
    http_response_code($code);
    auth_json_headers();
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function auth_read_json($file, $fallback) {
    if (!file_exists($file)) return $fallback;
    $raw = @file_get_contents($file);
    if ($raw === false) return $fallback;
    $data = json_decode($raw, true);
    return $data === null ? $fallback : $data;
}

function auth_write_json($file, $data) {
    global $AUTH_DATA_DIR;
    if (!is_dir($AUTH_DATA_DIR)) @mkdir($AUTH_DATA_DIR, 0775, true);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
    $tmp = $file . '.tmp.' . getmypid();
    $fh = @fopen($tmp, 'w');
    if ($fh) {
        if (flock($fh, LOCK_EX)) {
            fwrite($fh, $json);
            fflush($fh);
            flock($fh, LOCK_UN);
        }
        fclose($fh);
        @rename($tmp, $file);
    } else {
        @file_put_contents($file, $json);
    }
    @chmod($file, 0664);
}

function auth_read_users() {
    global $AUTH_USERS_FILE, $AUTH_DATA_DIR;
    if (!file_exists($AUTH_USERS_FILE)) {
        if (!is_dir($AUTH_DATA_DIR)) @mkdir($AUTH_DATA_DIR, 0775, true);
        auth_write_json($AUTH_USERS_FILE, []);
    }
    $users = auth_read_json($AUTH_USERS_FILE, []);
    return is_array($users) ? $users : [];
}

function auth_read_sessions() {
    global $AUTH_SESSIONS_FILE;
    $s = auth_read_json($AUTH_SESSIONS_FILE, []);
    return (is_array($s) && !isset($s[0])) ? $s : [];
}

function auth_write_sessions($sessions) {
    global $AUTH_SESSIONS_FILE;
    auth_write_json($AUTH_SESSIONS_FILE, $sessions);
}

function auth_sha256($str, $salt) {
    return hash('sha256', $str . $salt);
}

function auth_gen_session_id() {
    return 'okno-' . bin2hex(random_bytes(18));
}

// Lit le cookie de session (sans dépendre de $_COOKIE déjà parsé).
function auth_cookie_value($name) {
    if (isset($_COOKIE[$name])) return $_COOKIE[$name];
    $header = isset($_SERVER['HTTP_COOKIE']) ? $_SERVER['HTTP_COOKIE'] : '';
    if (preg_match('/(?:^|;\s*)' . preg_quote($name, '/') . '=([^;]*)/', $header, $m)) {
        return urldecode($m[1]);
    }
    return null;
}

function auth_set_cookie($sid) {
    global $AUTH_COOKIE, $AUTH_TTL_S;
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https')
        || (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443);
    $expires = gmdate('D, d M Y H:i:s', time() + $AUTH_TTL_S) . ' GMT';
    $cookie = $AUTH_COOKIE . '=' . rawurlencode($sid)
        . '; Max-Age=' . $AUTH_TTL_S
        . '; Path=/; Expires=' . $expires
        . '; HttpOnly; SameSite=Lax'
        . ($secure ? '; Secure' : '');
    header('Set-Cookie: ' . $cookie, false);
}

function auth_clear_cookie() {
    global $AUTH_COOKIE;
    header('Set-Cookie: ' . $AUTH_COOKIE . '=; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax', false);
}

function auth_current_user() {
    global $AUTH_COOKIE, $AUTH_TTL_S;
    $sid = auth_cookie_value($AUTH_COOKIE);
    if (!$sid) return null;
    $sessions = auth_read_sessions();
    if (!isset($sessions[$sid]) || !is_array($sessions[$sid])) return null;
    $sess = $sessions[$sid];
    $created = isset($sess['created']) ? (int)$sess['created'] : 0;
    if ((time() * 1000) - $created > $AUTH_TTL_S * 1000) return null;
    $users = auth_read_users();
    foreach ($users as $u) {
        if (isset($u['id']) && $u['id'] === $sess['userId']) return $u;
    }
    return null;
}

function auth_public_user($user) {
    if (!$user) return null;
    return [
        'id' => isset($user['id']) ? $user['id'] : null,
        'login' => isset($user['login']) ? $user['login'] : null,
        'role' => isset($user['role']) ? $user['role'] : 'reader',
    ];
}

function auth_read_body() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}
