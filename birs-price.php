<?php
declare(strict_types=1);

// PHP 7.4+ with curl, dom and libxml extensions.
// Upload this single file to your PHP host and open its URL to receive JSON.
// Only the recent messages visible in Telegram's public preview are searched.

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

function extractPrices(string $html): array
{
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
    $messages = $xpath->query('//*[@data-post]');
    $latest = null;
    $latestId = -1;

    foreach ($messages as $message) {
        $post = $message->getAttribute('data-post');
        if (!preg_match('~^birs_tomorrow/([0-9]+)$~', $post, $idMatch)) {
            continue;
        }
        $textNodes = $xpath->query('.//*[contains(concat(" ", normalize-space(@class), " "), " tgme_widget_message_text ")]', $message);
        if ($textNodes->length === 0) {
            continue;
        }
        // Keep a word boundary where Telegram uses <br> instead of whitespace.
        $textNode = $textNodes->item(0);
        $breaks = $xpath->query('.//br', $textNode);
        foreach ($breaks as $break) {
            $break->parentNode->insertBefore($dom->createTextNode("\n"), $break);
        }
        $text = normalizePriceText($textNode->textContent);
        $pattern = '/بیرس\s+نقدی\s+تهران[^\p{L}\p{N}]*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(خرید|فروش)(?!\p{L})/u';
        preg_match_all($pattern, $text, $matches, PREG_SET_ORDER);
        $prices = [];
        foreach ($matches as $match) {
            $key = $match[2] === 'خرید' ? 'buy' : 'sell';
            // Strings preserve the exact quoted price, without unit conversion.
            $prices[$key] = str_replace(',', '', $match[1]);
        }

        $id = (int) $idMatch[1];
        // Both prices must belong to the same message; never mix different posts.
        if (!isset($prices['buy'], $prices['sell']) || $id <= $latestId) {
            continue;
        }
        $time = $xpath->query('.//time[@datetime]', $message)->item(0);
        $latestId = $id;
        $latest = [
            'ok' => true,
            'buy' => $prices['buy'],
            'sell' => $prices['sell'],
            'message_url' => 'https://t.me/' . $post,
            'message_date' => $time ? $time->getAttribute('datetime') : null,
            'fetched_at' => gmdate('c'),
        ];
    }

    if ($latest === null) {
        throw new RuntimeException('No message containing both Tehran cash buy and sell prices was found in the public preview.');
    }
    return $latest;
}

function fetchChannel(): string
{
    $curl = curl_init('https://t.me/s/birs_tomorrow');
    if ($curl === false) {
        throw new RuntimeException('Could not initialize cURL.');
    }
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_MAXREDIRS => 3,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 30,
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

// Including this file from another PHP script only loads the functions.
if (isset($_SERVER['SCRIPT_FILENAME']) && realpath($_SERVER['SCRIPT_FILENAME']) === __FILE__) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    try {
        if (!extension_loaded('curl') || !class_exists('DOMDocument')) {
            http_response_code(500);
            throw new RuntimeException('Enable the PHP curl and dom extensions.');
        }
        $result = extractPrices(fetchChannel());
    } catch (Throwable $error) {
        if (http_response_code() !== 500) {
            http_response_code(502);
        }
        $result = ['ok' => false, 'error' => $error->getMessage()];
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT) . "\n";
}
