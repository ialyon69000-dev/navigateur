<?php
/**
 * _content.php — contenu éditorial partagé par api/messages.php et
 * api/dispatches.php (portage fidèle du bloc « Contenu éditorial » de server.js).
 *
 * Règles, identiques aux deux versions :
 *   • lecture publique de la bande et des messages publiés ;
 *   • les brouillons de message ne sortent que pour la rédaction (?all=1) ;
 *   • écrire = session valide + rôle administrateur (« editor » dans ce projet,
 *     « admin » toléré pour les comptes édités à la main dans data/users.json) ;
 *   • un lecteur ne reçoit donc jamais la source d'un flux par son tableau de bord.
 */

require_once __DIR__ . '/auth/_auth.php';

$CONTENT_DATA_DIR = $AUTH_DATA_DIR;
$MESSAGES_FILE = $CONTENT_DATA_DIR . '/messages.json';
$DISPATCHES_FILE = $CONTENT_DATA_DIR . '/dispatches.json';
$MAX_MESSAGES = 80;
$MAX_DISPATCHES = 200;
$ADMIN_ROLES = ['editor', 'admin'];

/* ——— petits utilitaires d'écriture ——— */

function content_is_list($a) {
    if (!is_array($a) || $a === []) return is_array($a);
    $i = 0;
    foreach ($a as $k => $_) {
        if ($k !== $i++) return false;
    }
    return true;
}

function content_read($file) {
    $data = auth_read_json($file, []);
    if (!is_array($data)) return [];
    // un objet associatif à la place du tableau = fichier corrompu : on part de vide
    return content_is_list($data) ? array_values($data) : [];
}

function content_write($file, $list) {
    return auth_write_json($file, array_values($list));
}

/** Un id court, sans caractère de contrôle : il revient dans l'URL de suppression. */
function content_new_id($prefix) {
    return $prefix . '_' . base_convert((string)time(), 10, 36) . '_' . substr(bin2hex(random_bytes(3)), 0, 6);
}

/* ——— sanitisation (mêmes bornes que server.js) ——— */

function content_strcut($s, $max) {
    if (function_exists('mb_substr')) return mb_substr($s, 0, $max, 'UTF-8');
    $chars = preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY);
    return implode('', array_slice($chars, 0, $max));
}

function content_clamp($v, $max) {
    if ($v === null) return '';
    if (is_array($v)) $v = '';
    $s = preg_replace('/[\x00-\x1F\x7F]/u', ' ', (string)$v);
    $s = trim((string)$s);
    if (function_exists('mb_strlen')) {
        if (mb_strlen($s, 'UTF-8') > $max) return mb_substr($s, 0, $max, 'UTF-8');
        return $s;
    }
    $n = preg_match_all('/./us', $s);
    return ($n && $n > $max) ? content_strcut($s, $max) : $s;
}

/** Un champ bilingue accepte { ru, en } ou une chaîne simple (rangée en « ru »). */
function content_lang($v, $max) {
    if (is_array($v) && !isset($v[0])) {
        return [
            'ru' => content_clamp($v['ru'] ?? null, $max),
            'en' => content_clamp($v['en'] ?? null, $max),
        ];
    }
    return ['ru' => content_clamp($v, $max), 'en' => ''];
}

function content_has_text($field) {
    return is_array($field) && (($field['ru'] ?? '') !== '' || ($field['en'] ?? '') !== '');
}

function content_safe_url($v, $max) {
    $s = content_clamp($v, $max);
    if ($s === '' || $s === '#') return $s === '' ? null : $s;
    if (!preg_match('#^(https?:)?//#i', $s) && strpos($s, '/') !== 0) return null;
    return $s;
}

function content_safe_iso($v) {
    $s = content_clamp($v, 40);
    $ts = $s === '' ? false : strtotime($s);
    return $ts === false ? gmdate('c') : gmdate('c', $ts);
}

/**
 * Champs reconstruits à partir de l'existant quand la requête n'en porte qu'une
 * partie — c'est le cas de « publier / retirer », qui n'envoie que « active ».
 */
function content_sanitize_message($in, $base) {
    $base = is_array($base) ? $base : [];
    $pick = function ($key, $max) use ($in, $base) {
        return content_clamp(array_key_exists($key, $in) ? $in[$key] : ($base[$key] ?? null), $max);
    };
    return [
        'title' => content_lang(array_key_exists('title', $in) ? $in['title'] : ($base['title'] ?? null), 160),
        'body' => content_lang(array_key_exists('body', $in) ? $in['body'] : ($base['body'] ?? null), 1400),
        'active' => array_key_exists('active', $in)
            ? !($in['active'] === false || $in['active'] === 'false' || $in['active'] === 0 || $in['active'] === '0')
            : (($base['active'] ?? true) !== false),
        'author' => $pick('author', 40),
    ];
}

function content_sanitize_dispatch($in, $base) {
    $base = is_array($base) ? $base : [];
    $pick = function ($key, $max) use ($in, $base) {
        return content_clamp(array_key_exists($key, $in) ? $in[$key] : ($base[$key] ?? null), $max);
    };
    $out = [
        'category' => $pick('category', 60),
        'source' => $pick('source', 60),
        'sourceId' => preg_replace('/[^a-z0-9._-]/', '', strtolower($pick('sourceId', 40))) ?: null,
        'title' => $pick('title', 240),
        'summary' => $pick('summary', 900),
        'link' => content_safe_url(array_key_exists('link', $in) ? $in['link'] : ($base['link'] ?? null), 400),
        'image' => content_safe_url(array_key_exists('image', $in) ? $in['image'] : ($base['image'] ?? null), 400),
        'publishedAt' => array_key_exists('publishedAt', $in)
            ? content_safe_iso($in['publishedAt'])
            : (content_clamp($base['publishedAt'] ?? null, 40) ?: gmdate('c')),
    ];
    if (!$out['sourceId'] && $out['source'] !== '') {
        $slug = preg_replace('/[^a-z0-9._-]+/i', '-', strtolower($out['source']));
        $slug = trim($slug, '-');
        $out['sourceId'] = $slug === '' ? null : $slug;
    }
    return $out;
}

/* ——— droits ——— */

function content_is_admin($user) {
    global $ADMIN_ROLES;
    if (!is_array($user)) return false;
    $role = strtolower(trim((string)($user['role'] ?? 'reader')));
    return in_array($role, $ADMIN_ROLES, true);
}

/** Écrire exige une session valide et un rôle administrateur ; sinon ça sort. */
function content_require_admin() {
    $user = auth_current_user();
    if (!$user) {
        auth_json([
            'ok' => false,
            'code' => 'auth-required',
            'error' => 'Войдите в редакцию, чтобы менять содержимое.',
        ], 401);
    }
    if (!content_is_admin($user)) {
        auth_json([
            'ok' => false,
            'code' => 'admin-required',
            'error' => 'Только редакция может менять ленту и сообщения.',
        ], 403);
    }
    return $user;
}

function content_write_error() {
    auth_json([
        'ok' => false,
        'code' => 'write-failed',
        'error' => 'Сервер не может записать data/: проверьте права (chmod 777 data/, 666 data/*.json).',
    ], 500);
}

/** Un message / une dépêche, du plus récemment touché au plus ancien. */
function content_sorted($items) {
    usort($items, function ($a, $b) {
        $ta = strtotime((string)($a['updatedAt'] ?? $a['createdAt'] ?? ''));
        $tb = strtotime((string)($b['updatedAt'] ?? $b['createdAt'] ?? ''));
        return $tb <=> $ta;
    });
    return $items;
}
