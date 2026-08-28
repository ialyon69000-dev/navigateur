<?php
/**
 * api/messages.php — les messages que la rédaction affiche dans le tableau de
 * bord des utilisateurs (dashboards : public/dashboard.html et sa copie PHP).
 *
 *   GET    /api/messages          → messages publiés (tous) ; ?all=1 pour la
 *                                   rédaction seule, qui voit aussi ses brouillons
 *   POST   /api/messages          → créer ou mettre à jour (admin seulement)
 *   DELETE /api/messages?id=…     → supprimer (admin seulement)
 *
 * Le titre et le texte sont bilingues { ru, en } : le client choisit la langue,
 * le serveur ne traduit jamais un rôle ni un libellé d'interface.
 */

require_once __DIR__ . '/_content.php';

$method = $_SERVER['REQUEST_METHOD'];
$user = auth_current_user();

/* ——— lecture ——— */
if ($method === 'GET' || $method === 'HEAD') {
    $items = content_read($GLOBALS['MESSAGES_FILE']);
    $wants_all = (($_GET['all'] ?? '') === '1') && content_is_admin($user);
    if (!$wants_all) {
        $items = array_values(array_filter($items, function ($m) {
            return is_array($m) && ($m['active'] ?? true) !== false;
        }));
    }
    auth_json([
        'ok' => true,
        'updatedAt' => gmdate('c'),
        'items' => content_sorted($items),
    ]);
}

/* ——— écriture (admin) ——— */
if ($method === 'POST' || $method === 'PUT') {
    $editor = content_require_admin();
    $in = auth_read_body();
    $items = content_read($GLOBALS['MESSAGES_FILE']);
    $id = content_clamp($in['id'] ?? null, 40);

    $idx = null;
    if ($id !== '') {
        foreach ($items as $i => $m) {
            if (isset($m['id']) && $m['id'] === $id) { $idx = $i; break; }
        }
        // un id inconnu n'est jamais une création déguisée
        if ($idx === null) {
            auth_json(['ok' => false, 'code' => 'not-found', 'error' => 'Сообщение не найдено.'], 404);
        }
    }

    $base = $idx === null ? [] : $items[$idx];
    $next = content_sanitize_message($in, $base);
    // L'auteur est un login de session, jamais une valeur du client.
    $next['author'] = $idx === null
        ? ($editor['login'] ?? 'okno')
        : (content_clamp($base['author'] ?? null, 40) ?: ($editor['login'] ?? 'okno'));

    if (!content_has_text($next['title'])) {
        auth_json(['ok' => false, 'code' => 'title-required', 'error' => 'Заполните заголовок хотя бы на одном языке.'], 400);
    }

    $now = gmdate('c');
    if ($idx === null) {
        array_unshift($items, array_merge($next, [
            'id' => content_new_id('m'),
            'createdAt' => $now,
            'updatedAt' => $now,
        ]));
    } else {
        $items[$idx] = array_merge($next, [
            'id' => $base['id'],
            'createdAt' => $base['createdAt'] ?? $now,
            'updatedAt' => $now,
        ]);
    }
    if (count($items) > $GLOBALS['MAX_MESSAGES']) $items = array_slice($items, 0, $GLOBALS['MAX_MESSAGES']);

    if (!content_write($GLOBALS['MESSAGES_FILE'], $items)) content_write_error();
    auth_json(['ok' => true, 'updatedAt' => $now, 'items' => array_values($items)]);
}

/* ——— suppression (admin) ——— */
if ($method === 'DELETE') {
    content_require_admin();
    $in = auth_read_body();
    $id = content_clamp($_GET['id'] ?? ($in['id'] ?? null), 40);
    $items = content_read($GLOBALS['MESSAGES_FILE']);
    $kept = array_values(array_filter($items, function ($m) use ($id) {
        return !isset($m['id']) || $m['id'] !== $id;
    }));
    if (count($kept) === count($items)) {
        auth_json(['ok' => false, 'code' => 'not-found', 'error' => 'Сообщение не найдено.'], 404);
    }
    if (!content_write($GLOBALS['MESSAGES_FILE'], $kept)) content_write_error();
    auth_json(['ok' => true, 'removed' => $id, 'updatedAt' => gmdate('c'), 'items' => $kept]);
}

auth_json(['ok' => false, 'error' => 'method not allowed'], 405);
