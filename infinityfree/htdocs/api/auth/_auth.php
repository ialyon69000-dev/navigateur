<?php
/**
 * _auth.php — logique d'authentification partagée (portée depuis server.js).
 *
 * Mécanisme (identique côté Node et côté PHP) :
 *   • un cookie « okno-session » contient un identifiant de session aléatoire ;
 *   • les sessions vivent dans data/sessions.json ({ sid: { userId, created } }),
 *     les comptes dans data/users.json ;
 *   • le mot de passe en clair n'est jamais reçu par le serveur : le navigateur
 *     envoie H1 = sha256(mot_de_passe + sel), et le serveur stocke
 *     H2 = sha256(H1 + sel) (champ « hash », « scheme » = 2).
 *
 * Les comptes créés avant ce schéma (scheme 1 : hash = sha256(mot_de_passe + sel))
 * sont migrés automatiquement au premier login réussi — sans jamais recevoir le
 * mot de passe en clair (le navigateur calcule lui-même le hash de l'ancien schéma).
 */

$AUTH_DATA_DIR = __DIR__ . '/../../data';
$AUTH_USERS_FILE = $AUTH_DATA_DIR . '/users.json';
$AUTH_SESSIONS_FILE = $AUTH_DATA_DIR . '/sessions.json';
$AUTH_COOKIE = 'okno-session';
$AUTH_TTL_S = 24 * 60 * 60; // 24 h
$AUTH_SCHEME = 2;          // schéma de hachage courant
$AUTH_SALT_RE = '/^[A-Za-z0-9._-]{1,64}$/';

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
    if ($raw === false || $raw === '') return $fallback;
    $data = json_decode($raw, true);
    return $data === null ? $fallback : $data;
}

/**
 * Écriture atomique. Renvoie true en cas de succès, false sinon : sur un
 * hébergement mutualisé le dossier data/ est souvent en lecture seule
 * (chmod 644) et l'écriture échoue en silence — d'où le booléen, pour
 * pouvoir répondre une erreur explicite au lieu d'un « ok » mensonger.
 */
function auth_write_json($file, $data) {
    global $AUTH_DATA_DIR;
    if (!is_dir($AUTH_DATA_DIR)) @mkdir($AUTH_DATA_DIR, 0775, true);
    $json = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
    $tmp = $file . '.tmp.' . getmypid();
    $ok = false;
    $fh = @fopen($tmp, 'w');
    if ($fh) {
        if (@flock($fh, LOCK_EX)) {
            $written = fwrite($fh, $json);
            fflush($fh);
            @flock($fh, LOCK_UN);
            $ok = ($written === strlen($json));
        }
        fclose($fh);
        if ($ok) {
            $ok = @rename($tmp, $file);
            if (!$ok) $ok = (@file_put_contents($file, $json) !== false);
        }
        @unlink($tmp);
    } else {
        $ok = (@file_put_contents($file, $json) !== false);
    }
    if ($ok) @chmod($file, 0664);
    return (bool)$ok;
}

/** Le dossier data/ est-il inscriptible ? (diagnostic /api/health) */
function auth_data_dir_writable() {
    global $AUTH_DATA_DIR;
    if (!is_dir($AUTH_DATA_DIR)) @mkdir($AUTH_DATA_DIR, 0775, true);
    if (!is_dir($AUTH_DATA_DIR) || !is_writable($AUTH_DATA_DIR)) return false;
    $probe = $AUTH_DATA_DIR . '/.probe.' . getmypid();
    if (@file_put_contents($probe, 'x') === false) return false;
    @unlink($probe);
    return true;
}

/** Message d'erreur actionnable quand data/ n'est pas inscriptible. */
function auth_storage_error() {
    return 'Сервер не может записать файл сессий: проверьте права на папку data/ (chmod 777 data/, 666 data/*.json).';
}

function auth_read_users() {
    global $AUTH_USERS_FILE, $AUTH_DATA_DIR;
    if (!file_exists($AUTH_USERS_FILE)) {
        if (!is_dir($AUTH_DATA_DIR)) @mkdir($AUTH_DATA_DIR, 0775, true);
        auth_write_json($AUTH_USERS_FILE, []);
    }
    $users = auth_read_json($AUTH_USERS_FILE, []);
    return is_array($users) ? array_values($users) : [];
}

function auth_read_sessions() {
    global $AUTH_SESSIONS_FILE;
    $s = auth_read_json($AUTH_SESSIONS_FILE, []);
    return (is_array($s) && !isset($s[0])) ? $s : [];
}

function auth_write_sessions($sessions) {
    global $AUTH_SESSIONS_FILE;
    return auth_write_json($AUTH_SESSIONS_FILE, $sessions);
}

function auth_sha256($str) {
    return hash('sha256', (string)$str);
}

/* ——— Chaînes UTF-8 sans dépendre de l'extension mbstring ——— */

function auth_strtolower($str) {
    $str = (string)$str;
    if (function_exists('mb_strtolower')) return mb_strtolower($str, 'UTF-8');
    return strtolower($str);
}

function auth_strlen($str) {
    $str = (string)$str;
    if (function_exists('mb_strlen')) return mb_strlen($str, 'UTF-8');
    $n = preg_match_all('/./us', $str);
    return $n === false ? strlen($str) : $n;
}

/* ——— Schéma de hachage ——— */

/**
 * H2 = sha256(H1 + sel), H1 = sha256(mot_de_passe + sel) calculé par le navigateur.
 */
function auth_hash_from_client($clientHash, $salt) {
    return auth_sha256($clientHash . $salt);
}

/** Sel de substitution pour un login inconnu : évite l'énumération de comptes. */
function auth_decoy_salt($login) {
    return substr(auth_sha256('okno-decoy|' . auth_strtolower(trim((string)$login))), 0, 16);
}

/** Sel fourni par le navigateur à l'inscription : format strict. */
function auth_valid_salt($salt) {
    return is_string($salt) && preg_match($GLOBALS['AUTH_SALT_RE'], $salt) === 1;
}

/**
 * Sel déjà stocké : on ne peut pas imposer le format strict, les comptes créés
 * avant dérivaient le sel du login (« jean marc-m1abc »), espaces et cyrillique
 * compris. Seul compte : non vide, court, sans caractère de contrôle — sinon la
 * connexion de ces comptes-là casserait.
 */
function auth_salt_is_usable($salt) {
    return is_string($salt) && $salt !== '' && strlen($salt) <= 64
        && preg_match('/[\x00-\x1F\x7F]/', $salt) === 0;
}

/** Hash client attendu : 64 caractères hexadécimaux. */
function auth_valid_client_hash($hash) {
    return is_string($hash) && preg_match('/^[a-f0-9]{64}$/', $hash) === 1;
}

/** Retrouve un compte par login (insensible à la casse). */
function auth_find_user($users, $login) {
    $needle = auth_strtolower(trim((string)$login));
    foreach ($users as $i => $u) {
        if (isset($u['login']) && auth_strtolower($u['login']) === $needle) {
            return [$i, $u];
        }
    }
    return [null, null];
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

function auth_is_https() {
    if (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') return true;
    if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https') return true;
    if (isset($_SERVER['HTTP_X_FORWARDED_SSL']) && $_SERVER['HTTP_X_FORWARDED_SSL'] === 'on') return true;
    if (isset($_SERVER['SERVER_PORT']) && (int)$_SERVER['SERVER_PORT'] === 443) return true;
    return false;
}

function auth_set_cookie($sid) {
    global $AUTH_COOKIE, $AUTH_TTL_S;
    $expires = gmdate('D, d M Y H:i:s', time() + $AUTH_TTL_S) . ' GMT';
    $cookie = $AUTH_COOKIE . '=' . rawurlencode($sid)
        . '; Max-Age=' . $AUTH_TTL_S
        . '; Path=/; Expires=' . $expires
        . '; HttpOnly; SameSite=Lax'
        . (auth_is_https() ? '; Secure' : '');
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
        // Le tableau de bord affiche la date de création du compte.
        'createdAt' => isset($user['createdAt']) ? $user['createdAt'] : null,
    ];
}

function auth_read_body() {
    $raw = file_get_contents('php://input');
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/**
 * Le mot de passe en clair est refusé sans exception : s'il arrive, c'est
 * qu'un navigateur sert une ancienne copie de auth.js (cache).
 */
function auth_reject_cleartext($body) {
    if (isset($body['password']) && (string)$body['password'] !== '') {
        auth_json([
            'ok' => false,
            'error' => 'Старая версия скрипта входа. Обновите страницу (Ctrl+F5) и попробуйте снова.',
            'reason' => 'cleartext-password',
        ], 400);
    }
}
