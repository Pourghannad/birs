<?php
declare(strict_types=1);

// Single-file API: PHP 7.4+ with curl, dom and libxml.
// No parameters: latest quote (backward compatible).
// ?from=2026-10-01&to=2026-10-21: history, statistics and chart data.
// Dates are Gregorian, inclusive, in Asia/Tehran. See README.md for pagination.

function normalizePriceText(string $text): string
{
    $text = strtr($text, [
        '۰'=>'0', '۱'=>'1', '۲'=>'2', '۳'=>'3', '۴'=>'4',
        '۵'=>'5', '۶'=>'6', '۷'=>'7', '۸'=>'8', '۹'=>'9',
        '٠'=>'0', '١'=>'1', '٢'=>'2', '٣'=>'3', '٤'=>'4',
        '٥'=>'5', '٦'=>'6', '٧'=>'7', '٨'=>'8', '٩'=>'9',
        'ي'=>'ی', 'ى'=>'ی', 'ك'=>'ک', '٬'=>',', '٫'=>'.',
    ]);
    // Remove Persian stretching, vowel marks and invisible direction marks.
    $text = preg_replace('/[\x{0640}\x{064B}-\x{065F}\x{0670}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2066}-\x{2069}\x{FEFF}]/u', '', $text);
    return preg_replace('/[\p{Z}\s]+/u', ' ', $text);
}

function parseChannelPage(string $html): array
{
    if (trim($html) === '') {
        throw new RuntimeException('Telegram returned an empty page.');
    }
    $dom = new DOMDocument();
    $previous = libxml_use_internal_errors(true);
    try {
        $loaded = $dom->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET);
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
    }
    if (!$loaded) {
        throw new RuntimeException('Could not parse the Telegram page.');
    }
    $xpath = new DOMXPath($dom);
    $hasClass = static function (string $name): string {
        return 'contains(concat(" ", normalize-space(@class), " "), " ' . $name . ' ")';
    };
    if ($xpath->query('//*[' . $hasClass('tgme_channel_history') . ']')->length === 0) {
        throw new RuntimeException('Telegram public history is unavailable or its HTML format has changed.');
    }
    $posts = [];
    foreach ($xpath->query('//*[@data-post]') as $message) {
        $post = $message->getAttribute('data-post');
        if (!preg_match('~^birs_tomorrow/([0-9]+)$~', $post, $idMatch)) {
            continue;
        }
        $id = (int) $idMatch[1];
        $time = $xpath->query('.//time[@datetime]', $message)->item(0);
        $date = null;
        if ($time) {
            $value = $time->getAttribute('datetime');
            if (preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:Z|[+-][0-9]{2}:[0-9]{2})$/D', $value)) {
                $parsed = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:sP', $value);
                $errors = DateTimeImmutable::getLastErrors();
                if ($parsed && (!$errors || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))) {
                    $date = $parsed;
                }
            }
        }
        $prices = [];
        $textNode = $xpath->query('.//*[' . $hasClass('tgme_widget_message_text') . ']', $message)->item(0);
        if ($textNode) {
            foreach ($xpath->query('.//br', $textNode) as $break) {
                $break->parentNode->insertBefore($dom->createTextNode("\n"), $break);
            }
            $text = normalizePriceText($textNode->textContent);
            $pattern = '/بیرس\s+نقدی\s+تهران[^\p{L}\p{N}]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(خرید|فروش)(?!\p{L})/u';
            preg_match_all($pattern, $text, $matches, PREG_SET_ORDER);
            foreach ($matches as $match) {
                $prices[$match[2] === 'خرید' ? 'buy' : 'sell'] = str_replace(',', '', $match[1]);
            }
        }
        $posts[$id] = [
            'message_id' => $id,
            'message_url' => 'https://t.me/' . $post,
            'message_date' => $date ? $date->format(DateTimeInterface::ATOM) : null,
            'timestamp' => $date ? $date->getTimestamp() : null,
            'buy' => $prices['buy'] ?? null,
            'sell' => $prices['sell'] ?? null,
        ];
    }
    $older = $xpath->query('//a[' . $hasClass('tme_messages_more') . ']')->item(0);
    $nextBefore = null;
    if ($older) {
        $cursor = filter_var($older->getAttribute('data-before'), FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
        if ($cursor === false) {
            throw new RuntimeException('Telegram returned an invalid older-page cursor.');
        }
        $nextBefore = $cursor;
    }
    return ['posts' => $posts, 'next_before' => $nextBefore];
}

function extractPrices(string $html): array
{
    $posts = parseChannelPage($html)['posts'];
    krsort($posts, SORT_NUMERIC);
    foreach ($posts as $post) {
        if ($post['buy'] !== null && $post['sell'] !== null) {
            return [
                'ok' => true, 'buy' => $post['buy'], 'sell' => $post['sell'],
                'message_url' => $post['message_url'], 'message_date' => $post['message_date'],
                'fetched_at' => gmdate('c'),
            ];
        }
    }
    throw new RuntimeException('No message containing both Tehran cash buy and sell prices was found in the public preview.');
}

function historyOptions(array $query): array
{
    $timezone = new DateTimeZone('Asia/Tehran');
    $dates = [];
    foreach (['from', 'to'] as $key) {
        if (!array_key_exists($key, $query)) {
            $dates[$key] = null;
            continue;
        }
        $value = $query[$key];
        if (!is_string($value) || !preg_match('/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/D', $value)) {
            throw new InvalidArgumentException($key . ' must be a Gregorian date in YYYY-MM-DD format.');
        }
        $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $timezone);
        if (!$date || $date->format('Y-m-d') !== $value) {
            throw new InvalidArgumentException($key . ' is not a valid date.');
        }
        $dates[$key] = $date;
    }
    if ($dates['from'] && $dates['to'] && $dates['from'] > $dates['to']) {
        throw new InvalidArgumentException('from must be on or before to.');
    }
    $integers = [];
    foreach (['max_pages' => [20, 100], 'before' => [null, PHP_INT_MAX]] as $key => $limits) {
        if (!array_key_exists($key, $query)) {
            $integers[$key] = $limits[0];
            continue;
        }
        $value = $query[$key];
        if ((!is_string($value) && !is_int($value)) ||
            filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => $limits[1]]]) === false) {
            throw new InvalidArgumentException($key . ' must be an integer between 1 and ' . $limits[1] . '.');
        }
        $integers[$key] = (int) $value;
    }
    return [
        'from' => $dates['from'] ? $dates['from']->format('Y-m-d') : null,
        'to' => $dates['to'] ? $dates['to']->format('Y-m-d') : null,
        'from_timestamp' => $dates['from'] ? $dates['from']->getTimestamp() : null,
        // Exclusive next midnight includes every instant of the requested last day.
        'until_timestamp' => $dates['to'] ? $dates['to']->modify('+1 day')->getTimestamp() : null,
        'max_pages' => $integers['max_pages'], 'before' => $integers['before'],
    ];
}

function summarizeSeries(array $series): array
{
    $stats = ['buy' => ['min' => null, 'max' => null], 'sell' => ['min' => null, 'max' => null]];
    $daily = [];
    foreach ($series as $point) {
        $day = $point['date'];
        if (!isset($daily[$day])) {
            $daily[$day] = ['date' => $day, 'count' => 0];
            foreach (['buy', 'sell'] as $side) {
                $daily[$day][$side] = array_fill_keys(['open', 'high', 'low', 'close'], $point[$side]);
            }
        }
        $daily[$day]['count']++;
        foreach (['buy', 'sell'] as $side) {
            foreach (['min', 'max'] as $extreme) {
                $old = $stats[$side][$extreme];
                $better = $old === null || ($extreme === 'min' ? $point[$side] < $old['value'] : $point[$side] > $old['value']);
                // Strict comparison keeps the earliest occurrence of tied prices.
                if ($better) {
                    $stats[$side][$extreme] = [
                        'value' => $point[$side], 'time' => $point['time'],
                        'date' => $day, 'timestamp_ms' => $point['timestamp_ms'],
                        'message_url' => $point['message_url'],
                    ];
                }
            }
            $daily[$day][$side]['high'] = max($daily[$day][$side]['high'], $point[$side]);
            $daily[$day][$side]['low'] = min($daily[$day][$side]['low'], $point[$side]);
            $daily[$day][$side]['close'] = $point[$side];
        }
    }
    return ['stats' => $stats, 'daily' => array_values($daily)];
}

function collectHistory(array $options, ?callable $fetch = null): array
{
    $fetch = $fetch ?? 'fetchChannel';
    $before = $options['before'];
    $posts = [];
    $pages = 0;
    $complete = false;
    $reason = 'max_pages';
    $warnings = [];
    $undated = 0;
    $started = microtime(true);
    // Keep HTTP work within a typical shared-host request budget.
    while ($pages < $options['max_pages']) {
        $remaining = 25 - (microtime(true) - $started);
        if ($remaining < 1) {
            $reason = 'time_budget';
            break;
        }
        try {
            $page = parseChannelPage($fetch($before, max(1, min(15, (int) $remaining))));
        } catch (RuntimeException $error) {
            if ($pages === 0) {
                throw $error;
            }
            $reason = 'upstream_error';
            $warnings[] = $error->getMessage();
            break;
        }
        $pages++;
        $oldest = null;
        foreach ($page['posts'] as $id => $post) {
            if ($post['timestamp'] !== null) {
                $oldest = $oldest === null ? $post['timestamp'] : min($oldest, $post['timestamp']);
            }
            if (!isset($posts[$id])) {
                $posts[$id] = $post;
            }
        }
        $next = $page['next_before'];
        if ($options['from_timestamp'] !== null && $oldest !== null && $oldest < $options['from_timestamp']) {
            $complete = true;
            $reason = 'from_reached';
            $before = null;
            break;
        }
        if ($next === null) {
            $complete = true;
            $reason = 'public_history_exhausted';
            $before = null;
            break;
        }
        if (($before !== null && $next >= $before) ||
            ($page['posts'] && $next > min(array_keys($page['posts'])))) {
            $reason = 'pagination_stalled';
            $warnings[] = 'Telegram did not provide an older page cursor.';
            $before = null;
            break;
        }
        $before = $next;
    }
    $timezone = new DateTimeZone('Asia/Tehran');
    $series = [];
    foreach ($posts as $post) {
        if ($post['buy'] === null || $post['sell'] === null) {
            continue;
        }
        $timestamp = $post['timestamp'];
        if ($timestamp === null) {
            $undated++;
            continue;
        }
        if (($options['from_timestamp'] !== null && $timestamp < $options['from_timestamp']) ||
            ($options['until_timestamp'] !== null && $timestamp >= $options['until_timestamp'])) {
            continue;
        }
        $date = (new DateTimeImmutable('@' . $timestamp))->setTimezone($timezone);
        $series[] = [
            'message_id' => $post['message_id'], 'message_url' => $post['message_url'],
            'time' => $date->format(DateTimeInterface::ATOM), 'date' => $date->format('Y-m-d'),
            'timestamp_ms' => $timestamp * 1000,
            'buy' => (float) $post['buy'], 'sell' => (float) $post['sell'],
            'spread' => round((float) $post['sell'] - (float) $post['buy'], 8),
        ];
    }
    usort($series, static function (array $a, array $b): int {
        return ($a['timestamp_ms'] <=> $b['timestamp_ms']) ?: ($a['message_id'] <=> $b['message_id']);
    });
    if ($undated > 0) {
        $complete = false;
        $warnings[] = $undated . ' price messages had no valid timestamp and were excluded.';
    }
    $summary = summarizeSeries($series);
    return [
        'ok' => true, 'channel' => 'birs_tomorrow', 'timezone' => 'Asia/Tehran',
        'price_unit' => 'as_published', 'from' => $options['from'], 'to' => $options['to'],
        'count' => count($series), 'complete' => $complete,
        'pagination' => ['pages_fetched' => $pages, 'stop_reason' => $reason, 'next_before' => $before],
        'warnings' => $warnings,
        'stats' => $summary['stats'], 'series' => $series, 'daily' => $summary['daily'],
        'fetched_at' => gmdate('c'),
    ];
}

function fetchChannel(?int $before = null, int $timeout = 15): string
{
    $url = 'https://t.me/s/birs_tomorrow' . ($before === null ? '' : '?before=' . $before);
    $curl = curl_init($url);
    if ($curl === false) {
        throw new RuntimeException('Could not initialize cURL.');
    }
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => min(10, $timeout),
        CURLOPT_TIMEOUT => $timeout,
        CURLOPT_ENCODING => '',
        CURLOPT_USERAGENT => 'Mozilla/5.0 (compatible; TelegramPriceReader/1.0)',
        CURLOPT_HTTPHEADER => ['Accept: text/html', 'Accept-Language: fa,en;q=0.8'],
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
        CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS,
    ]);
    try {
        $html = curl_exec($curl);
        if ($html === false) {
            throw new RuntimeException('Telegram connection failed: ' . curl_error($curl));
        }
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        if ($status !== 200 || trim($html) === '') {
            throw new RuntimeException('Telegram returned HTTP ' . $status . ' or an empty page.');
        }
        return $html;
    } finally {
        curl_close($curl);
    }
}

// Including this file only loads the functions, so callers and tests can reuse them.
if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    try {
        $options = historyOptions($_GET);
        $hasHistoryParams = count(array_intersect(['from', 'to', 'max_pages', 'before'], array_keys($_GET))) > 0;
        $mode = $_GET['mode'] ?? ($hasHistoryParams ? 'history' : 'latest');
        if (!is_string($mode) || !in_array($mode, ['history', 'latest'], true)) {
            throw new InvalidArgumentException('mode must be latest or history.');
        }
        if ($mode === 'latest' && $hasHistoryParams) {
            throw new InvalidArgumentException('Date and pagination parameters require mode=history.');
        }
        if (!extension_loaded('curl') || !class_exists('DOMDocument')) {
            http_response_code(500);
            throw new RuntimeException('Enable the PHP curl and dom extensions.');
        }
        $result = $mode === 'history' ? collectHistory($options) : extractPrices(fetchChannel());
    } catch (InvalidArgumentException $error) {
        http_response_code(400);
        $result = ['ok' => false, 'error' => $error->getMessage()];
    } catch (Throwable $error) {
        if (http_response_code() !== 500) {
            http_response_code(502);
        }
        $result = ['ok' => false, 'error' => $error->getMessage()];
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
}
