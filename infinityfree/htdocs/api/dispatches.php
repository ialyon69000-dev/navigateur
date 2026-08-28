<?php
/**
 * api/dispatches.php — la bande préparée par la rédaction (les « flux »).
 *
 *   GET    /api/dispatches   → les dépêches, sources comprises (page publique /auth/dispatches.html)
 *   POST   /api/dispatches   → créer ou mettre à jour (admin seulement)
 *   DELETE /api/dispatches?id=… → retirer une dépêche (admin seulement)
 *
 * Dans le tableau de bord, seul l'admin demande cette ressource : un lecteur
 * n'affiche que les messages de /api/messages (voir dashboard.js).
 */

require_once __DIR__ . '/_content.php';

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET' || $method === 'HEAD') {
    $items = content_read($GLOBALS['DISPATCHES_FILE']);
    usort($items, function ($a, $b) {
        return strtotime((string)($b['publishedAt'] ?? '')) <=> strtotime((string)($a['publishedAt'] ?? ''));
    });
    auth_json([
        'updatedAt' => gmdate('c'),
        'items' => array_values($items),
    ]);
}

if ($method === 'POST' || $method === 'PUT') {
    content_require_admin();
    $in = auth_read_body();
    $items = content_read($GLOBALS['DISPATCHES_FILE']);
    $id = content_clamp($in['id'] ?? null, 40);

    $idx = null;
    if ($id !== '') {
        foreach ($items as $i => $d) {
            if (isset($d['id']) && $d['id'] === $id) { $idx = $i; break; }
        }
        if ($idx === null) {
            auth_json(['ok' => false, 'code' => 'not-found', 'error' => 'Депеша не найдена.'], 404);
        }
    }

    $next = content_sanitize_dispatch($in, $idx === null ? [] : $items[$idx]);
    if ($next['title'] === '') {
        auth_json(['ok' => false, 'code' => 'title-required', 'error' => 'Заполните заголовок депеши.'], 400);
    }

    if ($idx === null) {
        array_unshift($items, array_merge($next, ['id' => content_new_id('d')]));
    } else {
        $items[$idx] = array_merge($next, ['id' => $items[$idx]['id']]);
    }
    if (count($items) > $GLOBALS['MAX_DISPATCHES']) $items = array_slice($items, 0, $GLOBALS['MAX_DISPATCHES']);

    if (!content_write($GLOBALS['DISPATCHES_FILE'], $items)) content_write_error();
    auth_json(['ok' => true, 'updatedAt' => gmdate('c'), 'items' => array_values($items)]);
}

if ($method === 'DELETE') {
    content_require_admin();
    $in = auth_read_body();
    $id = content_clamp($_GET['id'] ?? ($in['id'] ?? null), 40);
    $items = content_read($GLOBALS['DISPATCHES_FILE']);
    $kept = array_values(array_filter($items, function ($d) use ($id) {
        return !isset($d['id']) || $d['id'] !== $id;
    }));
    if (count($kept) === count($items)) {
        auth_json(['ok' => false, 'code' => 'not-found', 'error' => 'Депеша не найдена.'], 404);
    }
    if (!content_write($GLOBALS['DISPATCHES_FILE'], $kept)) content_write_error();
    auth_json(['ok' => true, 'removed' => $id, 'updatedAt' => gmdate('c'), 'items' => $kept]);
}

auth_json(['ok' => false, 'error' => 'method not allowed'], 405);
