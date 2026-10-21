export interface PricePoint {
  message_id: number;
  message_url: string;
  time: string;
  date: string;
  timestamp_ms: number;
  buy: number;
  sell: number;
  spread: number;
}

interface HistoryResponse {
  ok: boolean;
  error?: string;
  series?: PricePoint[];
  complete?: boolean;
  pagination?: {
    pages_fetched?: number;
    next_before?: number | null;
    stop_reason?: string;
  };
  warnings?: string[];
}

export interface DateRange {
  from: string;
  to: string;
}

export interface HistoryResult {
  points: PricePoint[];
  pagesFetched: number;
  complete: boolean;
  stopReason: string | null;
  warnings: string[];
}

const apiUrl = import.meta.env.VITE_API_URL || '/birs-price.php';

export function tehranToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

export function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isPricePoint(value: unknown): value is PricePoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<PricePoint>;
  return Number.isInteger(point.message_id) &&
    typeof point.message_url === 'string' &&
    typeof point.time === 'string' &&
    typeof point.date === 'string' &&
    Number.isFinite(point.timestamp_ms) &&
    Number.isFinite(point.buy) &&
    Number.isFinite(point.sell) &&
    Number.isFinite(point.spread);
}

export async function fetchHistory(
  range: DateRange,
  signal: AbortSignal,
  onProgress: (points: PricePoint[], pagesFetched: number) => void,
): Promise<HistoryResult> {
  const byId = new Map<number, PricePoint>();
  const warnings = new Set<string>();
  const seenCursors = new Set<number>();
  let before: number | null = null;
  let pagesFetched = 0;
  let stopReason: string | null = null;
  let complete = false;

  // The PHP API limits pages and request time. Continue transparently while
  // keeping a bounded number of browser requests for a very long archive.
  for (let chunk = 0; chunk < 12; chunk += 1) {
    const url = new URL(apiUrl, window.location.origin);
    url.searchParams.set('mode', 'history');
    url.searchParams.set('from', range.from);
    url.searchParams.set('to', range.to);
    url.searchParams.set('max_pages', '20');
    if (before !== null) url.searchParams.set('before', String(before));

    const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    let body: HistoryResponse;
    try {
      body = await response.json() as HistoryResponse;
    } catch {
      throw new Error('Invalid API response. Check the PHP endpoint.');
    }
    if (!response.ok || !body.ok) {
      throw new Error(body.error || `The API returned HTTP ${response.status}.`);
    }
    if (!Array.isArray(body.series) || !body.pagination) {
      throw new Error('The API response is missing required history fields.');
    }
    for (const point of body.series) {
      if (isPricePoint(point)) byId.set(point.message_id, point);
    }
    for (const warning of body.warnings || []) warnings.add(warning);
    pagesFetched += body.pagination.pages_fetched || 0;
    const sorted = [...byId.values()].sort(
      (a, b) => a.timestamp_ms - b.timestamp_ms || a.message_id - b.message_id,
    );
    onProgress(sorted, pagesFetched);

    stopReason = body.pagination.stop_reason || null;
    if (body.complete) {
      complete = true;
      break;
    }
    const next = body.pagination.next_before;
    if (typeof next !== 'number' || !Number.isInteger(next) || next <= 0 || seenCursors.has(next)) {
      break;
    }
    seenCursors.add(next);
    before = next;
  }

  return {
    points: [...byId.values()].sort((a, b) => a.timestamp_ms - b.timestamp_ms || a.message_id - b.message_id),
    pagesFetched,
    complete,
    stopReason,
    warnings: [...warnings],
  };
}

export function extrema(points: PricePoint[], side: 'buy' | 'sell') {
  if (points.length === 0) return { min: null, max: null };
  let min = points[0];
  let max = points[0];
  for (const point of points) {
    if (point[side] < min[side]) min = point;
    if (point[side] > max[side]) max = point;
  }
  return { min, max };
}

export function downloadCsv(points: PricePoint[]) {
  const lines = [
    'date,time,buy,sell,spread,message_url',
    ...points.map((point) => [point.date, point.time, point.buy, point.sell, point.spread, point.message_url].join(',')),
  ];
  const blob = new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = 'birs-prices.csv';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
