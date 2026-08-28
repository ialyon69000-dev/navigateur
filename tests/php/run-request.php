<?php
/**
 * run-request.php — exécute UNE requête HTTP simulée contre un script de l'API
 * et affiche le résultat en JSON sur stdout.
 *
 * Usage :
 *   php tests/php/run-request.php <htdocs-dir> <script> <METHOD> [json-body] [cookie] [query-json]
 *
 * Exemple :
 *   php tests/php/run-request.php /tmp/okno-xxx api/auth/login.php POST '{"login":"a","hash":"..."}'
 *
 * Le résultat (une ligne JSON) contient : status, headers, body, error.
 * Ce fichier ne sert qu'aux tests automatisés ; il n'est jamais déployé.
 */

class OknoFakeInputStream
{
    // Déclaré explicitement : PHP l'assigne au wrapper (sinon PHP >= 8.2 émet
    // un avertissement « dynamic property » qui polluerait la sortie JSON).
    public $context;
    private $data = '';
    private $pos = 0;

    public function stream_open($path, $mode, $options, &$opened_path)
    {
        if ($path !== 'php://input') return false;
        $this->data = isset($GLOBALS['__OKNO_INPUT']) ? (string)$GLOBALS['__OKNO_INPUT'] : '';
        $this->pos = 0;
        return true;
    }

    public function stream_read($count)
    {
        $chunk = substr($this->data, $this->pos, $count);
        $this->pos += strlen($chunk);
        return $chunk;
    }

    public function stream_eof()
    {
        return $this->pos >= strlen($this->data);
    }

    public function stream_stat()
    {
        return [];
    }

    public function stream_set_option($option, $arg1, $arg2)
    {
        return false;
    }
}

function okno_emit($payload)
{
    if (ob_get_level() > 0) {
        $payload['body'] = (string)ob_get_contents();
        while (ob_get_level() > 0) ob_end_clean();
    }
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR], true)) {
        $payload['error'] = $err['message'] . ' @ ' . $err['file'] . ':' . $err['line'];
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n";
}

$argvv = isset($argv) && is_array($argv) ? $argv : [];
$htdocs = isset($argvv[1]) ? $argvv[1] : '';
$script = isset($argvv[2]) ? $argvv[2] : '';
$method = isset($argvv[3]) ? strtoupper($argvv[3]) : 'GET';
$bodyRaw = isset($argvv[4]) ? $argvv[4] : '';
$cookie = isset($argvv[5]) ? $argvv[5] : '';
$queryJson = isset($argvv[6]) ? $argvv[6] : '{}';

if ($htdocs === '' || $script === '') {
    okno_emit(['status' => 0, 'headers' => [], 'body' => '', 'error' => 'usage: run-request.php <htdocs> <script> <METHOD> [body] [cookie] [query]']);
    exit(1);
}

$target = rtrim($htdocs, '/') . '/' . ltrim($script, '/');
if (!file_exists($target)) {
    okno_emit(['status' => 0, 'headers' => [], 'body' => '', 'error' => 'script introuvable: ' . $target]);
    exit(1);
}

$query = json_decode($queryJson, true);
if (!is_array($query)) $query = [];

$_SERVER = [
    'REQUEST_METHOD' => $method,
    'REQUEST_URI' => '/' . $script,
    'SCRIPT_NAME' => '/' . $script,
    'SCRIPT_FILENAME' => $target,
    'HTTP_HOST' => 'localhost',
    'HTTP_USER_AGENT' => 'okno-php-test',
    'REMOTE_ADDR' => '127.0.0.1',
    'SERVER_PORT' => '80',
];
$_GET = $query;
$_POST = [];
$_COOKIE = [];
if ($cookie !== '') {
    $_SERVER['HTTP_COOKIE'] = $cookie;
    foreach (explode(';', $cookie) as $pair) {
        $kv = explode('=', trim($pair), 2);
        if (count($kv) === 2) $_COOKIE[trim($kv[0])] = urldecode(trim($kv[1]));
    }
}
$GLOBALS['__OKNO_INPUT'] = $bodyRaw;

register_shutdown_function(function () {
    okno_emit([
        'status' => http_response_code(),
        'headers' => headers_list(),
        'body' => '',
    ]);
});

ob_start();

// Remplace php://input par le corps fourni (le SAPI CLI n'en a pas).
stream_wrapper_unregister('php');
stream_wrapper_register('php', 'OknoFakeInputStream');

require $target;
