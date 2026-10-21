# Birs Price API

A single-file PHP API that reads Tehran cash-market prices from the public preview of the [birs_tomorrow](https://t.me/birs_tomorrow) Telegram channel. It uses cURL and does not require a bot token.

## Installation

Upload `birs-price.php` to a host running **PHP 7.4 or newer** with the `curl`, `dom`, and `libxml` extensions enabled. The server must be able to reach `https://t.me`. No database or Composer is required.

## Usage

```text
/birs-price.php
/birs-price.php?from=2026-10-01&to=2026-10-21
/birs-price.php?mode=history&from=2026-10-01&to=2026-10-21&max_pages=50
```

With no parameters, the API preserves its original response: the latest message containing both prices, with `buy` and `sell` as strings, the message link, and its timestamp. `mode=latest` selects the same behavior.

Providing any of `from`, `to`, `max_pages`, or `before` enables history mode. To request history without a date filter, use `mode=history`. Combining history parameters with `mode=latest` returns HTTP 400.

| Parameter | Description |
| --- | --- |
| `from` | Start date, inclusive from the beginning of that day; optional |
| `to` | End date, inclusive through the end of that day; optional |
| `mode` | `latest` or `history` |
| `max_pages` | Maximum number of pages fetched per request; defaults to 20, accepts 1–100 |
| `before` | Message cursor used to continue with older pages; pass the value from the previous response |

Dates must be **Gregorian, in `YYYY-MM-DD` format, and use the `Asia/Tehran` time zone**. Jalali dates are not accepted. Omitting `from` means there is no lower date bound; omitting `to` means there is no upper bound. Invalid dates, reversed ranges, and invalid numeric parameters return a JSON response with HTTP 400.

## History and chart data

- `series`: matching prices in chronological order, with one point per message and no duplicate messages.
- Each point includes `message_id`, `message_url`, `time` with the Tehran time-zone offset, `date`, `timestamp_ms` for time axes, numeric `buy` and `sell` prices, and `spread` (sell minus buy).
- `stats.buy.min`, `stats.buy.max`, `stats.sell.min`, and `stats.sell.max`: each includes the value, date, time, `timestamp_ms`, and message link. When values tie, the earliest occurrence is selected.
- `daily`: daily buy and sell summaries with `open`, `high`, `low`, `close`, and the number of observations in `count`, suitable for candlestick charts.
- `count`: number of points in this response. For an empty range, the arrays are empty and the extrema are `null`.
- `complete`, `pagination`, and `warnings`: report data coverage and whether more pages remain.

A chart data point looks like this:

```json
{
  "time": "2026-10-20T17:04:06+03:30",
  "date": "2026-10-20",
  "timestamp_ms": 1792503246000,
  "buy": 330,
  "sell": 320,
  "spread": -10
}
```

Prepare chart series in JavaScript after receiving a complete response:

```js
const response = await fetch('birs-price.php?from=2026-10-01&to=2026-10-21');
const data = await response.json();
if (!response.ok || !data.ok) throw new Error(data.error || 'Request failed');
if (!data.complete) throw new Error('History is partial; continue pagination first');

const buy = data.series.map(p => ({ x: p.timestamp_ms, y: p.buy }));
const sell = data.series.map(p => ({ x: p.timestamp_ms, y: p.sell }));
const candles = data.daily.map(day => ({ date: day.date, ...day.buy }));
console.log({ buy, sell, candles, highestBuy: data.stats.buy.max });
```

Both prices must come from **the same message**. Messages missing either price and messages for other markets are excluded. Persian and Arabic numerals, Persian character elongation, and thousands separators are supported. Prices retain the values and units published by the channel: the API does not convert between rial and toman, swap buy and sell, or change the sign of the spread. Daily summaries use only observed messages; missing days are not filled with synthetic prices.

## Older history and pagination

The API starts at the newest page and follows the `before` cursor to read older pages, so date filters are not limited to the latest page. Each request is limited to 25 seconds of network work and `max_pages` pages. Configure the web server timeout to allow the request to finish.

If `complete=false` and `pagination.next_before` contains a number, continue with that cursor and the same date range:

```text
/birs-price.php?from=2026-10-01&to=2026-10-21&before=492&max_pages=20
```

`pagination.stop_reason` describes why the scan stopped: `from_reached`, `public_history_exhausted`, `max_pages`, `time_budget`, `upstream_error`, or `pagination_stalled`. A failure on the first page returns HTTP 502. A failure on a later page returns the data collected so far with `complete=false` and a warning. Price messages without a valid timestamp are excluded and reported in `warnings`.

When fetching multiple pages, merge the series by `message_id`, remove duplicates, and sort by `timestamp_ms` and then by message ID. **The statistics and OHLC values in each response only cover that response's points**; recalculate them after merging all pages. In PHP, use `summarizeSeries($mergedSeries)`. The final page with `complete=true` means that scan reached its lower bound; every earlier page must also have been fetched successfully.

`complete=true` means the scan reached the start of the requested range or the end of the **publicly visible history**. It does not guarantee that the full Telegram archive or market history is available. Deleted or private messages and changes to Telegram's HTML format cannot be recovered. Without a local archive, historical access is limited to what Telegram exposes in the public preview.

## Development and tests

You can `require` this file without triggering a network request. `collectHistory($options, $fetchCallback)` accepts a custom fetch callback, which allows pagination to be tested without network access.

```sh
php -l birs-price.php
php tests/run.php
```

The tests cover Tehran day boundaries, invalid dates, Persian numerals and decimals, backward-compatible output, pagination and continuation, duplicate removal, stopping conditions, upstream errors, empty data, extrema, and OHLC values.
