<?php
require __DIR__ . '/_auth.php';
$user = auth_current_user();
if (!$user) {
    auth_json(['ok' => false, 'user' => null]);
}
auth_json(['ok' => true, 'user' => auth_public_user($user)]);
