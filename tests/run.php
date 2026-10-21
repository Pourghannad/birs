<?php
declare(strict_types=1);
require __DIR__ . '/../birs-price.php';

$checks = 0;
function check(bool $condition, string $message): void
{
    global $checks;
    $checks++;
    if (!$condition) { throw new RuntimeException($message); }
}
function rejects(callable $action, string $class): void
{
    try { $action(); } catch (Throwable $e) {
        check($e instanceof $class, 'Wrong exception: ' . get_class($e));
        return;
    }
    throw new RuntimeException('Expected ' . $class);
}
function post(int $id, string $time, ?string $buy, ?string $sell, string $market = 'بیرس نــقدی تهران'): string
{
    $text = ($buy === null ? '' : $market . ' 💵 ' . $buy . ' خــرید');
    $text .= '<br>' . ($sell === null ? '' : $market . ' 💵 ' . $sell . ' فروش');
    return '<div data-post="birs_tomorrow/' . $id . '"><div class="tgme_widget_message_text">' . $text .
        '</div>' . ($time === '' ? '' : '<time datetime="' . $time . '"></time>') . '</div>';
}
function page(string $posts, ?int $before = null): string
{
    return '<section class="tgme_channel_history">' . $posts . ($before === null ? '' :
        '<a class="tme_messages_more" data-before="' . $before . '"></a>') . '</section>';
}

check(normalizePriceText('۱٬۲۳۴ خــريد ١٢٣') === '1,234 خرید 123', 'Numeral and Persian normalization');
$quote = extractPrices(page(post(1, '2026-10-20T10:00:00Z', '۱٬۳۳۰', '١٬٣٢٠')));
check($quote['buy'] === '1330' && $quote['sell'] === '1320', 'Legacy string prices');
$decimal = extractPrices(page(post(1, '2026-10-20T10:00:00Z', '۳۳۰٫۵', '۳۲۰٫۲۵')));
check($decimal['buy'] === '330.5' && $decimal['sell'] === '320.25', 'Decimal prices');
rejects(static function (): void {
    extractPrices(page(post(1, '2026-10-20T10:00:00Z', '330', null) . post(2, '2026-10-20T10:01:00Z', null, '320')));
}, RuntimeException::class);
rejects(static function (): void { parseChannelPage('<html>Login or upstream error</html>'); }, RuntimeException::class);

foreach ([['from' => '2026-02-30'], ['from' => '1405/07/28'], ['to' => ['2026-10-20']],
          ['from' => '2026-10-21', 'to' => '2026-10-20'], ['max_pages' => '101'],
          ['max_pages' => '0'], ['before' => '-1'], ['before' => '99999999999999999999999']] as $bad) {
    rejects(static function () use ($bad): void { historyOptions($bad); }, InvalidArgumentException::class);
}
$options = historyOptions(['from' => '2026-10-20', 'to' => '2026-10-20']);
check($options['from_timestamp'] === strtotime('2026-10-19T20:30:00Z'), 'Tehran lower midnight');
check($options['until_timestamp'] === strtotime('2026-10-20T20:30:00Z'), 'Inclusive last day');

$first = page(
    post(9, '2026-10-20T20:30:00Z', '999', '989') . // excluded: next local day
    post(8, '2026-10-20T20:29:59Z', '350', '340') .
    post(7, '2026-10-20T12:00:00Z', '300', '290'), 7);
$second = page(
    post(7, '2026-10-20T12:00:00Z', '300', '290') . // duplicate between pages
    post(6, '2026-10-20T11:00:00Z', '999', '989', 'بیرس فردایی تهران') .
    post(5, '2026-10-19T20:30:00Z', '330', '320') .
    post(4, '2026-10-19T20:29:59Z', '1', '2'), 4);
$calls = [];
$fetch = static function (?int $before, int $timeout) use ($first, $second, &$calls): string {
    $calls[] = $before;
    check($timeout >= 1 && $timeout <= 15, 'Bounded fetch timeout');
    if ($before === null) { return $first; }
    if ($before === 7) { return $second; }
    throw new RuntimeException('Should have stopped at lower date boundary');
};
$result = collectHistory($options, $fetch);
check($calls === [null, 7], 'Pagination follows older cursor');
check($result['complete'] && $result['pagination']['stop_reason'] === 'from_reached', 'Lower bound completion');
check(array_column($result['series'], 'message_id') === [5, 7, 8], 'Inclusive range, deduplication and chronological order');
check($result['count'] === 3, 'Wrong market excluded');
check($result['stats']['buy']['min']['value'] === 300.0, 'Buy minimum');
check($result['stats']['sell']['max']['value'] === 340.0, 'Sell maximum');
check($result['stats']['buy']['min']['time'] === '2026-10-20T15:30:00+03:30', 'Extreme includes Tehran timestamp');
check($result['series'][0]['timestamp_ms'] === $options['from_timestamp'] * 1000, 'Chart timestamps use milliseconds');
check($result['series'][0]['spread'] === -10.0, 'Signed sell minus buy spread');
check($result['daily'][0]['buy'] === ['open' => 330.0, 'high' => 350.0, 'low' => 300.0, 'close' => 350.0], 'Daily OHLC');
check($result['daily'][0]['count'] === 3, 'Daily sample count');

$partial = collectHistory(historyOptions(['max_pages' => '1']), $fetch);
check(!$partial['complete'] && $partial['pagination']['next_before'] === 7, 'Page cap exposes continuation cursor');
$continued = collectHistory(historyOptions(['before' => '7']), static function () use ($second): string {
    return str_replace('<a class="tme_messages_more" data-before="4"></a>', '', $second);
});
check($continued['complete'] && $continued['series'][0]['message_id'] === 4, 'Continuation starts at supplied cursor');
$failed = collectHistory(historyOptions([]), static function (?int $before) use ($first): string {
    if ($before !== null) { throw new RuntimeException('HTTP 429'); }
    return $first;
});
check(!$failed['complete'] && $failed['pagination']['stop_reason'] === 'upstream_error' && $failed['warnings'], 'Mid-scan error preserves explicit partial results');
$stalled = collectHistory(historyOptions(['before' => '7']), static function () use ($first): string { return $first; });
check(!$stalled['complete'] && $stalled['pagination']['stop_reason'] === 'pagination_stalled', 'Repeated cursor cannot loop');
$empty = collectHistory(historyOptions([]), static function (): string { return page(''); });
check($empty['complete'] && $empty['series'] === [] && $empty['stats']['buy']['min'] === null, 'Empty available history');
$undated = collectHistory(historyOptions([]), static function (): string { return page(post(1, '', '330', '320')); });
check(!$undated['complete'] && $undated['count'] === 0 && $undated['warnings'], 'Undated prices are excluded explicitly');
foreach (['tomorrow', '2026-02-30T10:00:00Z'] as $badTimestamp) {
    $invalidTime = collectHistory(historyOptions([]), static function () use ($badTimestamp): string {
        return page(post(1, $badTimestamp, '330', '320'));
    });
    check(!$invalidTime['complete'] && $invalidTime['count'] === 0, 'Invalid source timestamps never invent chart dates');
}
rejects(static function (): void {
    parseChannelPage('<div class="tgme_channel_history"><a class="tme_messages_more" data-before="bad"></a></div>');
}, RuntimeException::class);
$ties = collectHistory(historyOptions([]), static function (): string {
    return page(post(2, '2026-10-20T11:00:00Z', '330', '320') . post(1, '2026-10-20T10:00:00Z', '330', '320'));
});
check($ties['stats']['buy']['min']['message_url'] === 'https://t.me/birs_tomorrow/1', 'Tied extremes use earliest occurrence');
check(extractPrices($first)['buy'] === '999', 'Latest mode still uses newest post');
echo 'Passed ' . $checks . " assertions.\n";
