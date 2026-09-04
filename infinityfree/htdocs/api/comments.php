<?php
/**
 * api/comments.php — commentaires des lecteurs et de la rédaction sous les
 * messages publiés par l'éditeur (voir public/dashboard.html et sa copie PHP).
 *
 * Écrire un message reste réservé à la rédaction (rôle « editor »), mais tout
 * utilisateur connecté — lecteur comme éditeur — peut commenter les messages.
 *
 *   GET    /api/comments[?messageId=…] → commentaires visibles (messages
 *                                        publiés ; la rédaction voit aussi
 *                                        ceux de ses brouillons)
 *   POST   /api/comments               → ajouter (session valide : lecteur OU
 *                                        éditeur ; auteur = login de session)
 *   DELETE /api/comments?id=…          → retirer (son propre commentaire, ou
 *                                        n'importe lequel pour la rédaction)
 *
 * Un commentaire n'est pas bilingue : son auteur écrit dans la langue qu'il
 * veut, et le texte passe tel quel (jamais de HTML).
 */

require_once __DIR__ . '/_content.php';

$method = $_SERVER['REQUEST_METHOD'];
$user = auth_current_user();

/* ——— lecture : les commentaires des messages que l'on peut voir ——— */
if ($method === 'GET' || $method === 'HEAD') {
    $admin = content_is_admin($user);
    // Un commentaire vit avec son message : pour qui ne voit que les messages
    // publiés, les commentaires des brouillons n'existent pas. La rédaction,
    // elle, voit tout — brouillons et commentaires compris.
    $visible = [];
    foreach (content_read($GLOBALS['MESSAGES_FILE']) as $m) {
        if (is_array($m) && isset($m['id']) && ($admin || ($m['active'] ?? true) !== false)) {
            $visible[$m['id']] = true;
        }
    }
    $only = content_clamp($_GET['messageId'] ?? null, 40);
    $items = [];
    foreach (content_read($GLOBALS['COMMENTS_FILE']) as $c) {
        if (!is_array($c) || !isset($c['messageId']) || !isset($visible[$c['messageId']])) continue;
        if ($only !== '' && $c['messageId'] !== $only) continue;
        $items[] = $c;
    }
    // Ordre de lecture : du plus ancien au plus récent.
    usort($items, function ($a, $b) {
        $ta = strtotime((string)($a['createdAt'] ?? $a['updatedAt'] ?? ''));
        $tb = strtotime((string)($b['createdAt'] ?? $b['updatedAt'] ?? ''));
        return $ta <=> $tb;
    });
    auth_json(['ok' => true, 'updatedAt' => gmdate('c'), 'items' => $items]);
}

/* ——— écriture : tout utilisateur connecté (lecteur ou éditeur) ——— */
if ($method === 'POST' || $method === 'PUT') {
    $commenter = content_require_user();
    $in = auth_read_body();
    $msgId = content_clamp($in['messageId'] ?? null, 40);

    // Un lecteur ne commente que les messages publiés ; la rédaction peut aussi
    // commenter ses brouillons (ils restent invisibles hors de la rédaction).
    $target = null;
    foreach (content_read($GLOBALS['MESSAGES_FILE']) as $m) {
        if (is_array($m) && isset($m['id']) && $m['id'] === $msgId) { $target = $m; break; }
    }
    if ($target === null || (!content_is_admin($commenter) && ($target['active'] ?? true) === false)) {
        auth_json(['ok' => false, 'code' => 'message-not-found', 'error' => 'Сообщение не найдено.'], 404);
    }

    $next = content_sanitize_comment($in);
    if ($next['body'] === '') {
        auth_json(['ok' => false, 'code' => 'comment-required', 'error' => 'Заполните текст комментария.'], 400);
    }

    $now = gmdate('c');
    $comment = array_merge($next, [
        'id' => content_new_id('c'),
        // L'auteur est un login de session, jamais une valeur du client.
        'author' => $commenter['login'] ?? 'reader',
        'createdAt' => $now,
        'updatedAt' => $now,
    ]);
    $items = content_read($GLOBALS['COMMENTS_FILE']);
    $items[] = $comment;
    if (count($items) > $GLOBALS['MAX_COMMENTS']) $items = array_slice($items, -$GLOBALS['MAX_COMMENTS']);
    if (!content_write($GLOBALS['COMMENTS_FILE'], $items)) content_write_error();
    auth_json(['ok' => true, 'updatedAt' => $now, 'item' => $comment]);
}

/* ——— suppression : l'auteur, ou la rédaction pour modérer ——— */
if ($method === 'DELETE') {
    $commenter = content_require_user();
    $in = auth_read_body();
    $id = content_clamp($_GET['id'] ?? ($in['id'] ?? null), 40);
    $items = content_read($GLOBALS['COMMENTS_FILE']);
    $idx = null;
    foreach ($items as $i => $c) {
        if (isset($c['id']) && $c['id'] === $id) { $idx = $i; break; }
    }
    if ($idx === null) {
        auth_json(['ok' => false, 'code' => 'not-found', 'error' => 'Комментарий не найден.'], 404);
    }
    // Chacun retire son propre commentaire ; la rédaction modère l'ensemble.
    $isAuthor = isset($items[$idx]['author']) && $items[$idx]['author'] === ($commenter['login'] ?? null);
    if (!$isAuthor && !content_is_admin($commenter)) {
        auth_json(['ok' => false, 'code' => 'not-owner', 'error' => 'Можно удалить только свой комментарий.'], 403);
    }
    array_splice($items, $idx, 1);
    $items = array_values($items);
    if (!content_write($GLOBALS['COMMENTS_FILE'], $items)) content_write_error();
    auth_json(['ok' => true, 'removed' => $id, 'updatedAt' => gmdate('c'), 'items' => $items]);
}

auth_json(['ok' => false, 'error' => 'method not allowed'], 405);
