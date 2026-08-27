<?php
require __DIR__ . '/_auth.php';

$dispatches = auth_read_json($AUTH_DATA_DIR . '/dispatches.json', []);
if (!is_array($dispatches)) $dispatches = [];
auth_json([
    'updatedAt' => gmdate('c'),
    'items' => array_values($dispatches),
]);
