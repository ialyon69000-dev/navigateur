<?php
require __DIR__ . '/_auth.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    auth_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}
$sid = auth_cookie_value($AUTH_COOKIE);
if ($sid) {
    $sessions = auth_read_sessions();
    if (isset($sessions[$sid])) {
        unset($sessions[$sid]);
        auth_write_sessions($sessions);
    }
}
auth_clear_cookie();
auth_json(['ok' => true]);
