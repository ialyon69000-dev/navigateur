<?php
/*
 * Emergency-safe news endpoint for restrictive shared PHP hosting.
 *
 * This file intentionally has no XML, cURL, mbstring or modern-PHP
 * dependency. It must keep returning the last saved dispatches even on hosts
 * where outbound RSS connections or optional PHP extensions are unavailable.
 *
 * On top of the saved cache it ships an embedded snapshot of the latest
 * dispatches: when the local cache is missing, stale or nearly empty, the
 * endpoint merges embedded items so it always answers with at least
 * MIN_ITEMS dispatches (fresh cache items always win).
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
require_once __DIR__ . '/_common.php';

$MIN_ITEMS = 50;
$NEWS_TTL_MS = 5 * 60 * 1000;

// --- RSS feed definitions and refresh functions ---
$FEEDS = [
  ['id' => 'tass', 'name' => 'TASS', 'url' => 'https://tass.ru/rss/v2.xml', 'color' => '#c8102e'],
  ['id' => 'ria', 'name' => 'RIA Novosti', 'url' => 'https://ria.ru/export/rss2/index.xml', 'color' => '#e30613'],
  ['id' => 'lenta', 'name' => 'Lenta.ru', 'url' => 'https://lenta.ru/rss', 'color' => '#ee1c25'],
  ['id' => 'kommersant', 'name' => 'Коммерсантъ', 'url' => 'https://www.kommersant.ru/RSS/main.xml', 'color' => '#111111'],
  ['id' => 'izvestia', 'name' => 'Известия', 'url' => 'https://iz.ru/xml/rss/all.xml', 'color' => '#1a3c6e'],
  ['id' => 'mk', 'name' => 'МК', 'url' => 'https://www.mk.ru/rss/index.xml', 'color' => '#b71c1c'],
  ['id' => 'gazeta', 'name' => 'Газета.Ru', 'url' => 'https://www.gazeta.ru/export/rss/first.xml', 'color' => '#2c3e50'],
];

function _strip_html($s) {
  return trim(preg_replace(['/<!\[CDATA\[([\s\S]*?)\]\]>/', '/<script[\s\S]*?<\/script>/i', '/<style[\s\S]*?<\/style>/i', '/<[^>]+>/', '/\s+/'], ['$1', ' ', ' ', ' ', ' '], $s));
}

function _decode_entities($s) {
  return html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

function _to_utf8($raw, $from) {
  $from = strtolower((string)$from);
  if (in_array($from, ['cp1251', 'windows-1251', 'win-1251', 'win1251'], true)) {
    $from = 'windows-1251';
  }
  if ($from === 'utf8') $from = 'utf-8';
  if ($from === '' || $from === 'utf-8') return $raw;
  if (function_exists('iconv')) {
    $out = @iconv($from, 'UTF-8//IGNORE', $raw);
    if ($out !== false) return $out;
  }
  if (function_exists('mb_convert_encoding')) {
    $out = @mb_convert_encoding($raw, 'UTF-8', $from);
    if ($out !== false) return $out;
  }
  return $raw;
}

function _looks_broken_cyrillic($s) {
  $sample = substr((string)$s, 0, 4000);
  $cyr = preg_match_all('/[\x{0410}-\x{044F}\x{0401}\x{0451}]/u', $sample);
  $repl = substr_count($sample, '?') + substr_count($sample, "\xEF\xBF\xBD");
  return $cyr < 10 || $repl > 12;
}

function _item_title_broken($title) {
  $t = (string)$title;
  if ($t === '') return true;
  $cyr = preg_match_all('/[\x{0410}-\x{044F}\x{0401}\x{0451}]/u', $t);
  $q = substr_count($t, '?') + substr_count($t, "\xEF\xBF\xBD");
  return $cyr < 2 && $q >= 4;
}

function fetch_rss_feed($feed) {
  try {
    list($body, $ctype) = httpFetch($feed['url'], 12);
    $cs = 'utf-8';
    if (preg_match('/charset=([^\\s;]+)/i', (string)$ctype, $m)) {
      $cs = strtolower(trim($m[1], '"\''));
    }
    if (preg_match('/encoding=["\']([^"\']+)["\']/i', substr($body, 0, 220), $mXml)) {
      $xmlCs = strtolower(trim($mXml[1], '"\''));
      // Prefer the XML declaration: Gazeta.Ru often sends charset=utf-8
      // while the feed bytes and encoding= are windows-1251.
      if ($feed['id'] === 'gazeta' || $xmlCs !== 'utf-8') $cs = $xmlCs;
    } elseif ($feed['id'] === 'gazeta') {
      $cs = 'windows-1251';
    }
    $utf = _to_utf8($body, $cs);
    if (_looks_broken_cyrillic($utf)) {
      $retry = _to_utf8($body, 'windows-1251');
      if (!_looks_broken_cyrillic($retry)) $utf = $retry;
    }
    // After converting bytes, rewrite encoding so SimpleXML does not
    // re-decode windows-1251 and turn Cyrillic into "????".
    $utf = preg_replace('/encoding=["\'][^"\']+["\']/i', 'encoding="UTF-8"', $utf, 1);
    if (stripos(substr($utf, 0, 80), 'encoding=') === false) {
      $utf = preg_replace('/<\?xml([^>]*)\?>/i', '<?xml$1 encoding="UTF-8"?>', $utf, 1);
    }
    $xml = @simplexml_load_string($utf, 'SimpleXMLElement', LIBXML_NOWARNING | LIBXML_NOERROR);
    if (!$xml || !$xml->channel) return [];
    $items = [];
    $i = 0;
    foreach ($xml->channel->item as $item) {
      if ($i >= 24) break; $i++;
      $title = trim(_strip_html(_decode_entities((string)$item->title)));
      if (!$title || _item_title_broken($title)) continue;
      $link = (string)$item->link ?: '#';
      $guid = (string)$item->guid ?: $link;
      $cat = '';
      if ($item->category) {
        $cat = trim(_strip_html(_decode_entities((string)$item->category[0])));
      }
      $pubDate = (string)$item->pubDate ?: (string)$item->children('dc', true)->date;
      $iso = null;
      if ($pubDate) {
        $ts = strtotime($pubDate);
        if ($ts) $iso = gmdate('c', $ts);
      }
      $desc = trim(_strip_html(_decode_entities((string)$item->description)));
      $summary = mb_substr($desc, 0, 280);
      $image = null;
      if ($item->enclosure && preg_match('/image/i', (string)$item->enclosure['type'] ?: '')) {
        $image = (string)$item->enclosure['url'];
      }
      foreach ($item->children('media', true)->content as $mc) {
        $url = (string)$mc->attributes()->url;
        if ($url) { $image = $url; break; }
      }
      if (!$image) {
        foreach ($item->children('media', true)->thumbnail as $mt) {
          $url = (string)$mt->attributes()->url;
          if ($url) { $image = $url; break; }
        }
      }
      // Force HTTPS to avoid Mixed Content warnings
      if ($image && strpos($image, 'http://') === 0) {
        $image = 'https://' . substr($image, 7);
      }
      $items[] = [
        'id' => $feed['id'] . '-' . $guid,
        'title' => $title,
        'link' => $link,
        'source' => $feed['name'],
        'sourceId' => $feed['id'],
        'color' => $feed['color'],
        'category' => $cat ?: null,
        'publishedAt' => $iso,
        'summary' => $summary,
        'image' => $image,
      ];
    }
    return $items;
  } catch (Exception $e) {
    return [];
  }
}

function refresh_news_cache($cacheFile, $feeds) {
  $results = [];
  foreach ($feeds as $feed) {
    $results[] = fetch_rss_feed($feed);
  }
  $all = [];
  foreach ($results as $items) {
    $all = array_merge($all, $items);
  }
  if (empty($all)) return false;
  usort($all, function($a, $b) {
    $ta = isset($a['publishedAt']) ? strtotime($a['publishedAt']) : 0;
    $tb = isset($b['publishedAt']) ? strtotime($b['publishedAt']) : 0;
    return $tb - $ta;
  });
  $seen = [];
  $unique = [];
  foreach ($all as $it) {
    $key = mb_strtolower(mb_substr($it['title'] ?? '', 0, 100));
    if (isset($seen[$key])) continue;
    $seen[$key] = true;
    $unique[] = $it;
  }
  $balanced = [];
  $leftover = [];
  $perSource = [];
  foreach ($unique as $it) {
    $sid = $it['sourceId'];
    $n = $perSource[$sid] ?? 0;
    if ($n < 12) { $balanced[] = $it; $perSource[$sid] = $n + 1; }
    else { $leftover[] = $it; }
  }
  $final = array_slice(array_merge($balanced, $leftover), 0, 120);
  $tmp = $cacheFile . '.tmp';
  file_put_contents($tmp, json_encode(['at' => (int)(microtime(true) * 1000), 'items' => $final, 'errors' => []], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n");
  rename($tmp, $cacheFile);
  return true;
}

$EMBEDDED_ITEMS = array(
        array(
            'id' => 'https://ria.ru/20260817/zelenskiy-2111456839.html',
            'title' => '"Это капитуляция". Отчаянный шаг Зеленского вызвал изумление в США',
            'link' => 'https://ria.ru/20260817/zelenskiy-2111456839.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:43:48.000Z',
            'summary' => '"Это капитуляция". Отчаянный шаг Зеленского вызвал изумление в США',
        ),
        array(
            'id' => 'mk-https://tula.mk.ru/incident/2026/08/17/glava-tulskoy-oblasti-podvel-itog-vechernego-naleta-ukrainskikh-dronov.html',
            'title' => 'Глава Тульской области подвел итог вечернего налета украинских дронов',
            'link' => 'https://tula.mk.ru/incident/2026/08/17/glava-tulskoy-oblasti-podvel-itog-vechernego-naleta-ukrainskikh-dronov.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:43:41.000Z',
            'summary' => 'Подразделения противовоздушной обороны МО России уничтожили два украинских беспилотных летательных аппарата в небе над Тульской областью',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/98/36/1d/33/c17bd65f87c0b1498f983c0c4b212dc3.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/kursk-2111456689.html',
            'title' => 'В Курске из-за атаки БПЛА повреждены остекление двух балконов дома',
            'link' => 'https://ria.ru/20260817/kursk-2111456689.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:43:27.000Z',
            'summary' => 'В Курске из-за атаки БПЛА повреждены остекление двух балконов дома',
            'image' => 'https://cdnn21.img.ria.ru/images/07e9/03/0b/2004261247_0:160:3072:1888_650x0_80_0_0_bd64fd7da277981319bdd15f90467f6f.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/vsu-2111456535.html',
            'title' => 'Боевики из "Птиц Мадьяра" охотятся на мирных жителей, заявили в "Ахмате"',
            'link' => 'https://ria.ru/20260817/vsu-2111456535.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:43:02.000Z',
            'summary' => 'Боевики из "Птиц Мадьяра" охотятся на мирных жителей, заявили в "Ахмате"',
        ),
        array(
            'id' => 'https://tass.ru/nauka/28020129',
            'title' => 'Ученые с помощью ИИ и дронов смогут предсказывать голод среди диких животных',
            'link' => 'https://tass.ru/nauka/28020129',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Северо-Запад',
            'publishedAt' => '2026-08-17T19:41:53.000Z',
            'summary' => 'Первую цифровую карту-схему среды обитания животных разработали специалисты из Новгородского государственного университета и Санкт-Петербурга',
        ),
        array(
            'id' => 'mk-https://www.mk.ru/politics/2026/08/17/ugroza-pokusheniya-velika-supruga-trampa-ispugalas-za-ego-zhizn.html',
            'title' => '&#34;Угроза покушения велика&#34;: Супруга Трампа испугалась за его жизнь',
            'link' => 'https://www.mk.ru/politics/2026/08/17/ugroza-pokusheniya-velika-supruga-trampa-ispugalas-za-ego-zhizn.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Политика',
            'publishedAt' => '2026-08-17T19:40:57.000Z',
            'summary' => 'Супруга президента США Мелания Трамп испытывает всё большее беспокойство за безопасность своего мужа Дональда Трампа из-за растущей угрозы покушения, о чём сообщает Daily Mail со ссылкой на информиров',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/a2/e1/99/fc/4696ee84f4f818d1bb0afa35ce946692.jpg',
        ),
        array(
            'id' => 'https://lenta.ru/news/2026/08/17/melanya-tramp-obespokoilas-za-svoego-supruga-iz-za-riskov-pokusheniya-na-nego/',
            'title' => 'Меланья Трамп обеспокоилась за своего супруга из-за рисков покушения на него',
            'link' => 'https://lenta.ru/news/2026/08/17/melanya-tramp-obespokoilas-za-svoego-supruga-iz-za-riskov-pokusheniya-na-nego/',
            'source' => 'Lenta.ru',
            'sourceId' => 'lenta',
            'color' => '#ee1c25',
            'category' => 'Мир',
            'publishedAt' => '2026-08-17T19:40:26.000Z',
            'image' => 'https://icdn.lenta.ru/images/2026/08/17/22/20260817224039826/pic_78a67423257aa53dc494d722a810047d.jpg',
        ),
        array(
            'id' => 'mk-https://www.mk.ru/politics/2026/08/17/reyting-trampa-upal-do-rekordno-nizkoy-otmetki.html',
            'title' => 'Рейтинг Трампа упал до рекордно низкой отметки',
            'link' => 'https://www.mk.ru/politics/2026/08/17/reyting-trampa-upal-do-rekordno-nizkoy-otmetki.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Политика',
            'publishedAt' => '2026-08-17T19:40:17.000Z',
            'summary' => 'Рейтинг популярности президента США Дональда Трампа снизился до 33%, что стало самым низким показателем с момента его инаугурации 20 января 2025 года.',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/5e/29/22/c3/4105db395b92f23e0825c280ed5fd6b2.jpg',
        ),
        array(
            'id' => 'https://tass.ru/obschestvo/28020171',
            'title' => 'Пропавшие на Эльбрусе альпинисты приехали из Севастополя',
            'link' => 'https://tass.ru/obschestvo/28020171',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:40:12.000Z',
            'summary' => 'Информация уточняется, отметили в региональном МЧС',
        ),
        array(
            'id' => 'https://tass.ru/mezhdunarodnaya-panorama/28020165',
            'title' => 'Замглавы Минобороны Польши заявил, что страна готовится к возможной войне',
            'link' => 'https://tass.ru/mezhdunarodnaya-panorama/28020165',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'В мире',
            'publishedAt' => '2026-08-17T19:39:43.000Z',
            'summary' => 'Цезарий Томчик также упомянул, что Варшава работает над созданием комплексной системы защиты от беспилотников SAN в рамках проекта "Восточный щит", который предполагает строительство оборонительных ру',
        ),
        array(
            'id' => 'mk-https://kavkaz.mk.ru/social/2026/08/17/v-kislovodske-zanovo-perezhili-lyubov-i-tragediyu-gumilyova.html',
            'title' => 'В Кисловодске заново пережили любовь и трагедию Гумилёва',
            'link' => 'https://kavkaz.mk.ru/social/2026/08/17/v-kislovodske-zanovo-perezhili-lyubov-i-tragediyu-gumilyova.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:38:57.000Z',
            'summary' => 'Всепоглощающей, почти неземной стала любовь молодого поэта Николая Гумилёва к Анне Ахматовой.',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/86/6e/af/8a/03144d43c10db65dcf5ef1b796a33d2c.jpg',
        ),
        array(
            'id' => 'mk-https://vrn.mk.ru/sport/2026/08/17/voronezhskiy-buran-oderzhal-volevuyu-pobedu-nad-ryazanyuvdv-v-kontrolnom-matche.html',
            'title' => 'Воронежский «Буран» одержал волевую победу над «Рязанью-ВДВ» в контрольном матче',
            'link' => 'https://vrn.mk.ru/sport/2026/08/17/voronezhskiy-buran-oderzhal-volevuyu-pobedu-nad-ryazanyuvdv-v-kontrolnom-matche.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Спорт',
            'publishedAt' => '2026-08-17T19:38:54.000Z',
            'summary' => 'Встреча выдалась напряжённой',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/ca/e8/2e/5c/467760a3f2ac72629df62dfbe65dff89.jpg',
        ),
        array(
            'id' => 'mk-https://kavkaz.mk.ru/social/2026/08/17/s-nachala-goda-prokuratura-stavropolya-rassmotrela-bolee-6500-zhalob-na-deystviya-sledstvennykh-organov.html',
            'title' => 'С начала года прокуратура Ставрополья рассмотрела более 6500 жалоб на действия следственных органов',
            'link' => 'https://kavkaz.mk.ru/social/2026/08/17/s-nachala-goda-prokuratura-stavropolya-rassmotrela-bolee-6500-zhalob-na-deystviya-sledstvennykh-organov.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:38:51.000Z',
            'summary' => 'Соблюдение прав ставропольцев на досудебной стадии уголовного судопроизводства находится на особом контроле прокурора региона Юрия Немкина',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/1d/42/ea/e4/f90afad48d973bbe73647037e0c284cc.jpg',
        ),
        array(
            'id' => 'https://tass.ru/proisshestviya/28020167',
            'title' => 'В Курске при детонации БПЛА повреждены несколько автомобилей и два балкона',
            'link' => 'https://tass.ru/proisshestviya/28020167',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:38:41.000Z',
            'summary' => 'Никто не пострадал',
        ),
        array(
            'id' => 'https://iz.ru/2150663/2026-08-17/cnn-pokazal-pustye-ustanovki-patriot-pod-kievom',
            'title' => 'CNN показал пустые установки Patriot под Киевом',
            'link' => 'https://iz.ru/2150663/2026-08-17/cnn-pokazal-pustye-ustanovki-patriot-pod-kievom',
            'source' => 'Известия',
            'sourceId' => 'izvestia',
            'color' => '#1a3c6e',
            'publishedAt' => '2026-08-17T19:37:50.000Z',
            'summary' => 'Журналисты CNN 17 августа показали пустые пусковые установки комплексов Patriot, расположенные в полях под Киевом. Украинские военные предоставили телеканалу доступ к одной из батарей, чтобы продемонс',
        ),
        array(
            'id' => 'mk-https://www.mk-belgorod.ru/social/2026/08/17/maloimushhie-belgorodcy-smogut-zaklyuchit-sockontrakt-dlya-pokupki-edy-i-odezhdy.html',
            'title' => 'Малоимущие белгородцы смогут заключить соцконтракт для покупки еды и одежды',
            'link' => 'https://www.mk-belgorod.ru/social/2026/08/17/maloimushhie-belgorodcy-smogut-zaklyuchit-sockontrakt-dlya-pokupki-edy-i-odezhdy.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:37:43.000Z',
            'summary' => 'В Министерстве социальной защиты населения и труда Белгородской области напомнили о возможности заключить соцконтракт для преодоления трудной жизненной ситуации',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/12/articles/facebookPicture/5c/f6/fd/6e/1e92066d68f6a94c2e75be65980a9e1f.jpg',
        ),
        array(
            'id' => 'mk-https://chr.mk.ru/social/2026/08/17/v-kurske-bpla-atakoval-yugozapadnyy-mikrorayon-povrezhdeny-balkony-i-avtomobili.html',
            'title' => 'В Курске БПЛА атаковал Юго-западный микрорайон: повреждены балконы и автомобили',
            'link' => 'https://chr.mk.ru/social/2026/08/17/v-kurske-bpla-atakoval-yugozapadnyy-mikrorayon-povrezhdeny-balkony-i-avtomobili.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:37:13.000Z',
            'summary' => 'Курск вновь подвергся атаке беспилотников со стороны вооружённых формирований Украины',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/83/75/04/d8/5b8aafe307a70c5cf49e6b5c2cf1c200.jpg',
        ),
        array(
            'id' => 'mk-https://spb.mk.ru/social/2026/08/17/onemenie-ruk-posle-gadzhetov-mozhet-byt-pervym-priznakom-tunnelnogo-sindroma.html',
            'title' => 'Онемение рук после гаджетов может быть первым признаком туннельного синдрома',
            'link' => 'https://spb.mk.ru/social/2026/08/17/onemenie-ruk-posle-gadzhetov-mozhet-byt-pervym-priznakom-tunnelnogo-sindroma.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:36:24.000Z',
            'summary' => 'Онемение и покалывание в кистях после долгой работы за компьютером или смартфоном чаще всего связано с неудобным положением рук и перенапряжением. Однако если неприятные ощущения не проходят, они могу',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/19/articles/facebookPicture/a6/19/44/25/9604518f83f8070cdc697008e1421104.jpg',
        ),
        array(
            'id' => 'mk-https://www.mk.ru/social/2026/08/17/stala-izvestna-prichina-gibeli-eksmuzykanta-gruppy-cvety-petrovskogo.html',
            'title' => 'Стала известна причина гибели экс-музыканта группы «Цветы» Петровского',
            'link' => 'https://www.mk.ru/social/2026/08/17/stala-izvestna-prichina-gibeli-eksmuzykanta-gruppy-cvety-petrovskogo.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:36:13.000Z',
            'summary' => 'Бывший участник группы «Цветы» Владислав Петровский скончался в результате ДТП во Владимирской области.',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/f7/da/9f/a0/750f4c51787a586a22a15d1108212d9c.jpg',
        ),
        array(
            'id' => 'https://tass.ru/mezhdunarodnaya-panorama/28020163',
            'title' => 'РКушнер назвал сроки для разоружения ХАМАС',
            'link' => 'https://tass.ru/mezhdunarodnaya-panorama/28020163',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'В мире',
            'publishedAt' => '2026-08-17T19:35:57.000Z',
            'summary' => 'Он отметил, что процесс может начаться в течение 30 дней',
        ),
        array(
            'id' => 'https://ria.ru/20260817/italiya-2111455931.html',
            'title' => 'Глава МО Италии опроверг заявления о "русском следе" во взрыве под Римом',
            'link' => 'https://ria.ru/20260817/italiya-2111455931.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:35:42.000Z',
            'summary' => 'Глава МО Италии опроверг заявления о "русском следе" во взрыве под Римом',
        ),
        array(
            'id' => 'mk-https://volg.mk.ru/social/2026/08/17/10-tysyach-zhiteley-volgogradskoy-oblasti-vospolzovalis-podderzhkoy-semeynykh-mfc.html',
            'title' => '10 тысяч жителей Волгоградской области воспользовались поддержкой семейных МФЦ',
            'link' => 'https://volg.mk.ru/social/2026/08/17/10-tysyach-zhiteley-volgogradskoy-oblasti-vospolzovalis-podderzhkoy-semeynykh-mfc.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:34:35.000Z',
            'summary' => 'В этих центрах действует принцип «одного окна»: здесь можно проконсультироваться по вопросам воспитания и развития детей, оформить положенные меры соцподдержки, а также получить юридическую и психолог',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/6f/fd/1a/d5/2bc6981679d8a8a6a2eab545b561a136.jpg',
        ),
        array(
            'id' => 'https://tass.ru/mezhdunarodnaya-panorama/28020159',
            'title' => 'Рейтинг Трампа снизился до 33%',
            'link' => 'https://tass.ru/mezhdunarodnaya-panorama/28020159',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'В мире',
            'publishedAt' => '2026-08-17T19:34:13.000Z',
            'summary' => 'Согласно опросу международной службы Ipsos, это самый низкий показатель с момента инаугурации президента США в 2025 году',
        ),
        array(
            'id' => 'mk-https://vrn.mk.ru/social/2026/08/17/voronezhcev-predupredili-o-30gradusnoy-zhare-vo-vtornik.html',
            'title' => 'Воронежцев предупредили о 30-градусной жаре во вторник',
            'link' => 'https://vrn.mk.ru/social/2026/08/17/voronezhcev-predupredili-o-30gradusnoy-zhare-vo-vtornik.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:33:38.000Z',
            'summary' => 'Специалисты советуют горожанам с осторожностью планировать дела на открытом воздухе',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/87/97/70/0a/1a7242e73479e4f3f928991cb806eabc.jpg',
        ),
        array(
            'id' => 'https://iz.ru/2150661/muzykant-i-kompozitor-vladislav-petrovskii-biografiia-izi',
            'title' => 'Музыкант и композитор Владислав Петровский. Биография',
            'link' => 'https://iz.ru/2150661/muzykant-i-kompozitor-vladislav-petrovskii-biografiia-izi',
            'source' => 'Известия',
            'sourceId' => 'izvestia',
            'color' => '#1a3c6e',
            'publishedAt' => '2026-08-17T19:31:32.000Z',
            'summary' => 'Владислав Петровский — экс-участник группы «Цветы», клавишник, аранжировщик и композитор, известный по работе в коллективе Стаса Намина и созданию музыки к кинофильмам. О жизненном и творческом пути м',
        ),
        array(
            'id' => 'mk-https://spb.mk.ru/incident/2026/08/17/klavishnika-cvetov-vladislava-petrovskogo-nasmert-sbil-podrostok-na-pitbayke.html',
            'title' => 'Клавишника «Цветов» Владислава Петровского насмерть сбил подросток на питбайке',
            'link' => 'https://spb.mk.ru/incident/2026/08/17/klavishnika-cvetov-vladislava-petrovskogo-nasmert-sbil-podrostok-na-pitbayke.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:31:11.000Z',
            'summary' => 'Экс-участник группы «Цветы», аранжировщик и клавишник, ленинградец Владислав Петровский погиб в ДТП с питбайком во Владимирской области. Его сбил неизвестный подросток. Об этом сообщает ТАСС со ссылко',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/7a/73/1b/d8/32fc7439089606a68ea341007909e60c.jpg',
        ),
        array(
            'id' => 'mk-https://vologda.mk.ru/culture/2026/08/17/kinoteatru-vologdy-ispolnilos-segodnya-55-let.html',
            'title' => 'Кинотеатру Вологды исполнилось сегодня 55 лет',
            'link' => 'https://vologda.mk.ru/culture/2026/08/17/kinoteatru-vologdy-ispolnilos-segodnya-55-let.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Культура',
            'publishedAt' => '2026-08-17T19:31:04.000Z',
            'summary' => 'В 1971 году 17 августа впервые открыл двери кинотеатр имени Ленинского комсомола в областной столице',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/11/articles/facebookPicture/50/f1/9f/9d/891bb31f464bbb6bc4834ee2821b627a.jpg',
        ),
        array(
            'id' => 'https://iz.ru/2150662/2026-08-17/kamery-videonabliudeniia-proslediat-za-svalkami-v-ulan-ude',
            'title' => 'Камеры видеонаблюдения проследят за свалками в Улан-Удэ',
            'link' => 'https://iz.ru/2150662/2026-08-17/kamery-videonabliudeniia-proslediat-za-svalkami-v-ulan-ude',
            'source' => 'Известия',
            'sourceId' => 'izvestia',
            'color' => '#1a3c6e',
            'publishedAt' => '2026-08-17T19:31:01.000Z',
            'summary' => 'В Улан-Удэ начали устанавливать камеры видеонаблюдения в местах, где ранее были зафиксированы несанкционированные свалки. Они будут предотвращать повторное появление мусора, сообщает пресс-служба комб',
        ),
        array(
            'id' => 'https://tass.ru/proisshestviya/28020145',
            'title' => 'В ДНР при атаках украинских БПЛА погиб человек',
            'link' => 'https://tass.ru/proisshestviya/28020145',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:30:53.000Z',
            'summary' => 'Еще 10 пострадали',
        ),
        array(
            'id' => 'mk-https://www.mk-orel.ru/social/2026/08/17/stroitelstvo-studencheskogo-kampusa-v-orle-vypolneno-napolovinu.html',
            'title' => 'Строительство студенческого кампуса в Орле выполнено наполовину',
            'link' => 'https://www.mk-orel.ru/social/2026/08/17/stroitelstvo-studencheskogo-kampusa-v-orle-vypolneno-napolovinu.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:30:48.000Z',
            'summary' => 'В Орле готовность нового межвузовского студенческого кампуса уже перешагнула отметку в 51%',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/17/articles/facebookPicture/6b/3b/d8/9a/a1c4570ff5fa8c7e4cf5214f55817e96.jpg',
        ),
        array(
            'id' => 'mk-https://karel.mk.ru/social/2026/08/17/kapelki-minuvshey-nedeli-10-avgusta-16-avgusta-2026go-chast-ii.html',
            'title' => 'Капельки минувшей недели 10 августа – 16 августа 2026-го. ЧАСТЬ II',
            'link' => 'https://karel.mk.ru/social/2026/08/17/kapelki-minuvshey-nedeli-10-avgusta-16-avgusta-2026go-chast-ii.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:30:44.000Z',
            'summary' => 'Мы ежедневно чему-то удивляемся',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/15/articles/facebookPicture/91/fc/9e/22/beca5aa6dcd3f2a6a906d5983626d2d3.jpg',
        ),
        array(
            'id' => 'mk-https://www.mk-donbass.ru/social/2026/08/17/pushilin-obyavil-o-zavershenii-etapa-premii-gordost-donbassa.html',
            'title' => 'Пушилин объявил о завершении этапа премии «Гордость Донбасса»',
            'link' => 'https://www.mk-donbass.ru/social/2026/08/17/pushilin-obyavil-o-zavershenii-etapa-premii-gordost-donbassa.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:30:42.000Z',
            'summary' => 'Глава Донецкой Народной Республики Денис Пушилин объявил о завершении важного этапа в рамках республиканской премии «Гордость Донбасса» и её специального проекта «За дело»',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/19/articles/facebookPicture/49/a6/c7/26/720036e0b0c3a3b0128773a8dfe3e69f.jpg',
        ),
        array(
            'id' => 'mk-https://kostroma.mk.ru/economics/2026/08/17/dokhody-kostromichey-okazalis-vyshe-zhiteley-ivanovskoy-oblasti.html',
            'title' => 'Смертельное ДТП с участием питбайка и велосипедиста случилось в Петушинском районе',
            'link' => 'https://kostroma.mk.ru/economics/2026/08/17/dokhody-kostromichey-okazalis-vyshe-zhiteley-ivanovskoy-oblasti.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:30:32.000Z',
            'summary' => 'Возбуждено уголовное дело по факту гибели пожилого мужчины в страшном ДТП',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/21/articles/facebookPicture/5a/4a/10/ca/613c8767d6afd86c2316ef724166f381.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/kushner-2111455585.html',
            'title' => 'Кушнер заявил о интенсивных межправительственных контактах с Ираном',
            'link' => 'https://ria.ru/20260817/kushner-2111455585.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:30:20.000Z',
            'summary' => 'Кушнер заявил о интенсивных межправительственных контактах с Ираном',
        ),
        array(
            'id' => 'https://iz.ru/2150660/2026-08-17/vosem-alpinistov-na-elbruse-ne-vyshli-na-sviaz',
            'title' => 'Восемь альпинистов на Эльбрусе не вышли на связь',
            'link' => 'https://iz.ru/2150660/2026-08-17/vosem-alpinistov-na-elbruse-ne-vyshli-na-sviaz',
            'source' => 'Известия',
            'sourceId' => 'izvestia',
            'color' => '#1a3c6e',
            'publishedAt' => '2026-08-17T19:29:11.000Z',
            'summary' => 'Восемь альпинистов на Эльбрусе не вышли на связь, на их поиски направлена группа из 14 спасателей. Об этом 17 августа сообщила пресс-служба МЧС РФ по Кабардино-Балкарии. «В Кабардино-Балкарии проводят',
        ),
        array(
            'id' => 'https://ria.ru/20260817/nhfvg-2111455382.html',
            'title' => 'США не намерены добиваться продления меморандума с Ираном, заявил Трамп',
            'link' => 'https://ria.ru/20260817/nhfvg-2111455382.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:29:07.000Z',
            'summary' => 'США не намерены добиваться продления меморандума с Ираном, заявил Трамп',
        ),
        array(
            'id' => 'https://tass.ru/proisshestviya/28020155',
            'title' => 'Украинский БПЛА ударил по греческому танкеру Skiros в Черном море',
            'link' => 'https://tass.ru/proisshestviya/28020155',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:28:58.000Z',
            'summary' => 'По данным телеканала Skai, дрон сперва совершил разведывательный полет в акватории, после чего атаковал',
        ),
        array(
            'id' => 'https://lenta.ru/news/2026/08/17/v-rossiyskom-regione-zametili-bpla/',
            'title' => 'В российском регионе заметили БПЛА',
            'link' => 'https://lenta.ru/news/2026/08/17/v-rossiyskom-regione-zametili-bpla/',
            'source' => 'Lenta.ru',
            'sourceId' => 'lenta',
            'color' => '#ee1c25',
            'category' => 'Россия',
            'publishedAt' => '2026-08-17T19:28:58.000Z',
            'image' => 'https://icdn.lenta.ru/images/2026/08/17/22/20260817222906323/pic_9672ed17aabd86ec38cb08e87675dc9f.jpg',
        ),
        array(
            'id' => 'https://tass.ru/proisshestviya/28020147',
            'title' => 'Стали известны детали ДТП, в котором погиб экс-музыкант группы "Цветы" Петровский',
            'link' => 'https://tass.ru/proisshestviya/28020147',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:28:50.000Z',
            'summary' => 'По данным УМВД по Владимирской области, авария произошла 16 августа около 11:25 мск на ул. Проезд Мира в поселке Городищи Петушинского округа',
        ),
        array(
            'id' => 'mk-https://www.mk.ru/politics/2026/08/17/makron-podtverdil-gryadushhuyu-reformu-francuzskoy-armii.html',
            'title' => 'Макрон подтвердил грядущую реформу французской армии',
            'link' => 'https://www.mk.ru/politics/2026/08/17/makron-podtverdil-gryadushhuyu-reformu-francuzskoy-armii.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Политика',
            'publishedAt' => '2026-08-17T19:28:50.000Z',
            'summary' => 'Президент Франции Эмманюэль Макрон объявил о скором запуске программы добровольной военной службы для молодёжи.',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/43/1f/7a/c7/05be6c2f681b6c7c83008eb64a86bcda.jpg',
        ),
        array(
            'id' => 'https://lenta.ru/news/2026/08/17/tramp-pohvastalsya-otlichnymi-otnosheniyami-s-odnim-politikom/',
            'title' => 'Трамп похвастался отличными отношениями с одним политиком',
            'link' => 'https://lenta.ru/news/2026/08/17/tramp-pohvastalsya-otlichnymi-otnosheniyami-s-odnim-politikom/',
            'source' => 'Lenta.ru',
            'sourceId' => 'lenta',
            'color' => '#ee1c25',
            'category' => 'Мир',
            'publishedAt' => '2026-08-17T19:27:41.000Z',
            'image' => 'https://icdn.lenta.ru/images/2026/08/17/22/20260817222931588/pic_dabab27a56f2e8d5eff93fc0a6c77dc8.jpg',
        ),
        array(
            'id' => 'mk-https://www.mk-mari.ru/social/2026/08/17/pochemu-do-sentyabrya-luchshe-snyat-dengi-s-bankovskikh-kart-mir.html',
            'title' => 'Почему до сентября лучше снять деньги с банковских карт «Мир»',
            'link' => 'https://www.mk-mari.ru/social/2026/08/17/pochemu-do-sentyabrya-luchshe-snyat-dengi-s-bankovskikh-kart-mir.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:26:50.000Z',
            'summary' => 'Три неочевидные причины перевести сбережения на вклады уже в конце августа, чтобы не потерять в доходе и нервах.',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/10/articles/facebookPicture/0f/c6/37/59/be1ffb65a6c3a8b9915251c1ec845a7e.jpg',
        ),
        array(
            'id' => 'mk-https://www.mk.ru/incident/2026/08/17/v-avstralii-izmelchitel-drevesiny-pererabotal-cheloveka.html',
            'title' => 'В Австралии измельчитель древесины переработал человека',
            'link' => 'https://www.mk.ru/incident/2026/08/17/v-avstralii-izmelchitel-drevesiny-pererabotal-cheloveka.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:26:07.000Z',
            'summary' => 'В южноавстралийском регионе 26-летний Джош Томсон-Паркин трагически погиб, работая с промышленным дробильным оборудованием',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/1c/57/71/c4/45aba9c21966cef61e6c93fafa208bd8.jpg',
        ),
        array(
            'id' => 'https://tass.ru/proisshestviya/28020151',
            'title' => 'На Эльбрусе в КБР пропали восемь человек',
            'link' => 'https://tass.ru/proisshestviya/28020151',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Происшествия',
            'publishedAt' => '2026-08-17T19:24:51.000Z',
            'summary' => 'Они не вышли на связь в установленное время',
            'image' => 'https://cdn-media.tass.ru/fit/400x300_b2b00b17/tass/m2/uploads/i/20260817/9306467.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/uest-2111455158.html',
            'title' => 'VIP-ложи на концерт Канье Уэста в Петербурге раскупили за шесть часов',
            'link' => 'https://ria.ru/20260817/uest-2111455158.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:24:40.000Z',
            'summary' => 'VIP-ложи на концерт Канье Уэста в Петербурге раскупили за шесть часов',
        ),
        array(
            'id' => 'https://tass.ru/sport/28020149',
            'title' => 'Главный директор по операциям ФИФА покинул пост после критики Инфантино',
            'link' => 'https://tass.ru/sport/28020149',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Спорт',
            'publishedAt' => '2026-08-17T19:24:36.000Z',
            'summary' => 'Уход француза связан с его критикой президента ФИФА Джанни Инфантино',
        ),
        array(
            'id' => 'mk-https://www.mk.ru/culture/2026/08/17/prestuplenie-pered-aktyorskim-soobshhestvom-muzhikyan-otvetil-menshikovu.html',
            'title' => '«Преступление перед актёрским сообществом»: Мужикян ответил Меньшикову',
            'link' => 'https://www.mk.ru/culture/2026/08/17/prestuplenie-pered-aktyorskim-soobshhestvom-muzhikyan-otvetil-menshikovu.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Культура',
            'publishedAt' => '2026-08-17T19:23:29.000Z',
            'summary' => 'Актёр и режиссёр Самвел Мужикян известный по таким фильмам и сериалам как «Однажды в пустыне», «Непрощенный», «Светлана», «Екатерина',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/69/aa/7f/96/1ab27fe7bd53181d15a417b580b13ad0.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/moschi-2111454884.html',
            'title' => 'Мощи Спиридона Тримифунтского принесут в 12 регионов России для поклонения',
            'link' => 'https://ria.ru/20260817/moschi-2111454884.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:23:19.000Z',
            'summary' => 'Мощи Спиридона Тримифунтского принесут в 12 регионов России для поклонения',
        ),
        array(
            'id' => 'mk-https://www.mk.ru/science/2026/08/17/v-indii-nashli-drevneyshie-sledy-zhizni-na-zemle.html',
            'title' => 'В Индии нашли древнейшие следы жизни на Земле',
            'link' => 'https://www.mk.ru/science/2026/08/17/v-indii-nashli-drevneyshie-sledy-zhizni-na-zemle.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Наука',
            'publishedAt' => '2026-08-17T19:22:58.000Z',
            'summary' => 'Международная группа геологов под руководством индийского учёного Тризроты Чоудхури обнаружила на юго-востоке Индии отложения пород возрастом 3,5 миллиарда лет.',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/95/1d/f7/dc/7cb12705e75e7c3c0e6cb39bee0f0cb7.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/elbrus-2111454792.html',
            'title' => 'На Эльбрусе пропала группа из восьми альпинистов',
            'link' => 'https://ria.ru/20260817/elbrus-2111454792.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:22:23.000Z',
            'summary' => 'На Эльбрусе пропала группа из восьми альпинистов',
            'image' => 'https://cdnn21.img.ria.ru/images/07e6/06/03/1792979184_0:23:3072:1751_650x0_80_0_0_241794d081962042cf675d64849cd2f0.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/moschi-2111454628.html',
            'title' => 'Мощи Спиридона Тримифунтского доставили в Россию с Корфу',
            'link' => 'https://ria.ru/20260817/moschi-2111454628.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:20:42.000Z',
            'summary' => 'Мощи Спиридона Тримифунтского доставили в Россию с Корфу',
            'image' => 'https://cdnn21.img.ria.ru/images/152920/66/1529206665_0:233:2814:1816_650x0_80_0_0_e5cbb0d83bac7dd856e8bde82cf67f57.jpg',
        ),
        array(
            'id' => 'mk-https://kavkaz.mk.ru/social/2026/08/17/v-essentukakh-proydet-festival-vozdushnykh-sharov-kurortnoe-nebo.html',
            'title' => 'В Ессентуках пройдет фестиваль воздушных шаров «Курортное небо»',
            'link' => 'https://kavkaz.mk.ru/social/2026/08/17/v-essentukakh-proydet-festival-vozdushnykh-sharov-kurortnoe-nebo.html',
            'source' => 'МК',
            'sourceId' => 'mk',
            'color' => '#b71c1c',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:20:39.000Z',
            'summary' => 'В этом году центральным событием праздничной программы, посвященной Дню рождения Ессентуков, станет фестиваль воздухоплавания «Курортное небо»',
            'image' => 'https://static.mk.ru/upload/entities/2026/08/17/22/articles/facebookPicture/9d/ea/ab/96/d66f18f8885076e446b6b476cab227bd.jpg',
        ),
        array(
            'id' => 'https://ria.ru/20260817/mintrans-2111454334.html',
            'title' => 'Минтранс России рассказал об авиарейсах с Сирией',
            'link' => 'https://ria.ru/20260817/mintrans-2111454334.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:18:30.000Z',
            'summary' => 'Минтранс России рассказал об авиарейсах с Сирией',
            'image' => 'https://cdnn21.img.ria.ru/images/155735/65/1557356590_0:82:3072:1809_650x0_80_0_0_20256f1290498c49a6dca4d6d68b1ab7.jpg',
        ),
        array(
            'id' => 'https://tass.ru/obschestvo/28020135',
            'title' => 'В РФ впервые за восемь лет доставили десницу святителя Спиридона Тримифунтского',
            'link' => 'https://tass.ru/obschestvo/28020135',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:17:57.000Z',
            'summary' => 'Поклониться святыне можно будет в 12 регионах',
        ),
        array(
            'id' => 'https://tass.ru/obschestvo/28020133',
            'title' => 'Укринформ: в Днепропетровске сносят памятник коммунарам',
            'link' => 'https://tass.ru/obschestvo/28020133',
            'source' => 'TASS',
            'sourceId' => 'tass',
            'color' => '#c8102e',
            'category' => 'Общество',
            'publishedAt' => '2026-08-17T19:16:23.000Z',
            'summary' => 'Он был открыт в 1958 году',
        ),
        array(
            'id' => 'https://iz.ru/2150649/2026-08-17/troe-mirnykh-zhitelei-belgorodskoi-oblasti-postradali-v-rezultate-ataki-bpla',
            'title' => 'Трое мирных жителей Белгородской области пострадали в результате атаки БПЛА',
            'link' => 'https://iz.ru/2150649/2026-08-17/troe-mirnykh-zhitelei-belgorodskoi-oblasti-postradali-v-rezultate-ataki-bpla',
            'source' => 'Известия',
            'sourceId' => 'izvestia',
            'color' => '#1a3c6e',
            'publishedAt' => '2026-08-17T19:15:23.000Z',
            'summary' => 'Трое мирных жителей получили ранения в результате беспилотной атаки со стороны Вооруженных сил Украины (ВСУ) в Белгородской области. Об этом 17 августа сообщил оперштаб региона. «В селе Зозули Борисов',
        ),
        array(
            'id' => 'https://ria.ru/20260817/kushner-2111454075.html',
            'title' => 'Кушнер положительно оценил заявления ХАМАС на встрече в Египте',
            'link' => 'https://ria.ru/20260817/kushner-2111454075.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:15:20.000Z',
            'summary' => 'Кушнер положительно оценил заявления ХАМАС на встрече в Египте',
        ),
        array(
            'id' => 'https://ria.ru/20260817/stubby-2111453902.html',
            'title' => 'Стубб прокомментировал американскую анкету по поддержке внешней политики',
            'link' => 'https://ria.ru/20260817/stubby-2111453902.html',
            'source' => 'RIA Novosti',
            'sourceId' => 'ria',
            'color' => '#e30613',
            'category' => 'Лента новостей',
            'publishedAt' => '2026-08-17T19:15:02.000Z',
            'summary' => 'Стубб прокомментировал американскую анкету по поддержке внешней политики',
        ),
        array(
            'id' => 'https://lenta.ru/news/2026/08/17/gruppa-rossiyskih-turistov-propala-na-elbruse/',
            'title' => 'Группа российских туристов пропала на Эльбрусе',
            'link' => 'https://lenta.ru/news/2026/08/17/gruppa-rossiyskih-turistov-propala-na-elbruse/',
            'source' => 'Lenta.ru',
            'sourceId' => 'lenta',
            'color' => '#ee1c25',
            'category' => 'Путешествия',
            'publishedAt' => '2026-08-17T19:15:00.000Z',
            'image' => 'https://icdn.lenta.ru/images/2026/08/17/22/20260817222219818/pic_0ad65327e5d8d8a1fbdd3d1d6ebab08b.jpg',
        ),
        array(
            'id' => 'https://lenta.ru/news/2026/08/17/stalo-izvestno-o-proryve-vs-rossii-v-orehove/',
            'title' => 'Стало известно о прорыве ВС России в Орехове',
            'link' => 'https://lenta.ru/news/2026/08/17/stalo-izvestno-o-proryve-vs-rossii-v-orehove/',
            'source' => 'Lenta.ru',
            'sourceId' => 'lenta',
            'color' => '#ee1c25',
            'category' => 'Бывший СССР',
            'publishedAt' => '2026-08-17T19:12:21.000Z',
            'image' => 'https://icdn.lenta.ru/images/2026/08/17/22/20260817221233043/pic_34e372a6aa838cf8a392fc33e217c0d5.jpg',
        ),
);

$cacheFile = dirname(__FILE__) . '/../data/news_cache.json';
$raw = @file_get_contents($cacheFile);
$data = @json_decode($raw, true);

// Determine if the cache is stale and needs background refresh
$cacheStale = false;
if (is_array($data) && !empty($data['at'])) {
  $cacheAgeMs = (int)(microtime(true) * 1000) - (int)$data['at'];
  if ($cacheAgeMs > $NEWS_TTL_MS) {
    $cacheStale = true;
  }
} elseif (empty($data) || empty($data['items'])) {
  $cacheStale = true;
}

$items = array();
$mode = 'EMBEDDED';
if (is_array($data) && !empty($data['items']) && is_array($data['items'])) {
    foreach ($data['items'] as $it) {
        if (!empty($it['title']) && !_item_title_broken($it['title'])) $items[] = $it;
    }
    if (!empty($items)) $mode = 'STATIC';
}

if (count($items) < $MIN_ITEMS) {
    $seen = array();
    foreach ($items as $item) {
        if (!empty($item['title'])) {
            $seen[strtolower($item['title'])] = true;
        }
    }
    foreach ($EMBEDDED_ITEMS as $fallback) {
        if (count($items) >= $MIN_ITEMS) {
            break;
        }
        if (empty($fallback['title'])) {
            continue;
        }
        $key = strtolower($fallback['title']);
        if (isset($seen[$key])) {
            continue;
        }
        $seen[$key] = true;
        $items[] = $fallback;
    }
    $mode = ($mode === 'STATIC') ? 'STATIC+EMBEDDED' : 'EMBEDDED';
}

if (empty($items)) {
    http_response_code(503);
    echo json_encode(array(
        'updatedAt' => gmdate('c'),
        'sources' => array(),
        'items' => array(),
        'errors' => array(array('source' => 'cache', 'error' => 'Le cache du fil est absent ou vide.'))
    ));
    exit;
}

usort($items, 'news_sort_by_date');

$sources = array();
foreach ($items as $item) {
    if (!empty($item['sourceId']) && !isset($sources[$item['sourceId']])) {
        $sources[$item['sourceId']] = array(
            'id' => $item['sourceId'],
            'name' => isset($item['source']) ? $item['source'] : $item['sourceId']
        );
    }
}

header('X-Cache: ' . $mode);
echo json_encode(array(
    'updatedAt' => isset($data['at']) ? gmdate('c', (int) ($data['at'] / 1000)) : gmdate('c'),
    'sources' => array_values($sources),
    'items' => $items,
    'errors' => isset($data['errors']) && is_array($data['errors']) ? $data['errors'] : array()
), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

// If cache is stale and we served the cached data, refresh in the background
// so the next visitor gets the fresh edition
if ($cacheStale && count($items) >= $MIN_ITEMS) {
  // Try to close connection early (PHP-FPM) or flush then ignore abort
  if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
  } else {
    ignore_user_abort(true);
    if (ob_get_level()) ob_end_flush();
    flush();
  }
  // Fetch all RSS feeds in the background and save to cache
  refresh_news_cache($cacheFile, $FEEDS);
}

function news_sort_by_date($a, $b) {
    $ta = isset($a['publishedAt']) ? $a['publishedAt'] : '';
    $tb = isset($b['publishedAt']) ? $b['publishedAt'] : '';
    if ($ta === $tb) {
        return 0;
    }
    return ($ta > $tb) ? -1 : 1;
}
