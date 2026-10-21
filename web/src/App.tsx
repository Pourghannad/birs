import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, Input } from '@heroui/react';
import {
  Activity, ArrowDownLeft, ArrowUpRight, BarChart3, CalendarDays,
  Check, ChevronRight, CircleAlert, Download, ExternalLink, RefreshCw,
  TrendingDown, TrendingUp,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  daysBefore, downloadCsv, extrema, fetchHistory, isValidDate, tehranToday,
  type DateRange, type PricePoint,
} from './data';

type ViewMode = 'both' | 'buy' | 'sell';
type Phase = 'loading' | 'ready' | 'error';

const initialTo = tehranToday();
const initialRange: DateRange = {
  from: daysBefore(initialTo, 29),
  to: initialTo,
};
const digits = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Tehran',
});
const chartDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', timeZone: 'Asia/Tehran',
});
const fullDate = new Intl.DateTimeFormat('en-US', {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  timeZone: 'Asia/Tehran',
});

function number(value: number | null | undefined): string {
  return value == null ? '—' : digits.format(value);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : shortDate.format(date);
}

function latestTime(value: string | undefined): string {
  if (!value) return 'No rates recorded yet';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : fullDate.format(date);
}

function PriceCard({
  label, value, previous, tone, icon,
}: {
  label: string;
  value?: number;
  previous?: number;
  tone: 'buy' | 'sell' | 'spread';
  icon: ReactNode;
}) {
  const change = value != null && previous != null ? value - previous : null;
  return (
    <Card className={`metric-card metric-${tone}`}>
      <Card.Content className="metric-content">
        <div className="metric-top">
          <span className="metric-icon">{icon}</span>
          <span className="metric-caption">{label}</span>
        </div>
        <div className="metric-value-row">
          <strong className="metric-value" dir="ltr">{number(value)}</strong>
          <span className="metric-unit">as published</span>
        </div>
        <div className="metric-bottom">
          <span>Latest in range</span>
          {change != null && (
            <span className={`metric-change ${change > 0 ? 'change-up' : change < 0 ? 'change-down' : ''}`} dir="ltr">
              {change > 0 ? '+' : ''}{number(change)}
            </span>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}

function ExtremeCard({ title, tone, min, max }: {
  title: string;
  tone: 'buy' | 'sell';
  min: PricePoint | null;
  max: PricePoint | null;
}) {
  return (
    <Card className="extreme-card">
      <Card.Content className="extreme-content">
        <div className="extreme-title-row">
          <span className={`extreme-dot ${tone}`} />
          <h3>{title}</h3>
          <span className="subtle-label">Selected range</span>
        </div>
        <div className="extreme-grid">
          <div className="extreme-item">
            <div className="extreme-heading"><TrendingUp size={16} /> High</div>
            <strong dir="ltr">{number(max?.[tone])}</strong>
            {max ? <a href={max.message_url} target="_blank" rel="noreferrer" title="View source post">
              {dateLabel(max.date)} <ExternalLink size={13} />
            </a> : <span>—</span>}
          </div>
          <div className="extreme-item">
            <div className="extreme-heading"><TrendingDown size={16} /> Low</div>
            <strong dir="ltr">{number(min?.[tone])}</strong>
            {min ? <a href={min.message_url} target="_blank" rel="noreferrer" title="View source post">
              {dateLabel(min.date)} <ExternalLink size={13} />
            </a> : <span>—</span>}
          </div>
        </div>
      </Card.Content>
    </Card>
  );
}

function ChartTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload?: PricePoint }>;
}) {
  if (!active || !payload?.length || !payload[0].payload) return null;
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="tooltip-date">{latestTime(point.time)}</div>
      <div className="tooltip-line"><span className="legend-dot buy" /> Buy <b>{number(point.buy)}</b></div>
      <div className="tooltip-line"><span className="legend-dot sell" /> Sell <b>{number(point.sell)}</b></div>
    </div>
  );
}

function App() {
  const [draft, setDraft] = useState<DateRange>(initialRange);
  const [range, setRange] = useState<DateRange>(initialRange);
  const [period, setPeriod] = useState<number | null>(30);
  const [view, setView] = useState<ViewMode>('both');
  const [points, setPoints] = useState<PricePoint[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [pagesFetched, setPagesFetched] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const updateConnection = () => setIsOffline(!navigator.onLine);
    window.addEventListener('online', updateConnection);
    window.addEventListener('offline', updateConnection);
    return () => {
      window.removeEventListener('online', updateConnection);
      window.removeEventListener('offline', updateConnection);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setPhase('loading');
    setError(null);
    setComplete(false);
    setWarnings([]);
    setPagesFetched(0);
    setPoints([]);
    fetchHistory(range, controller.signal, (progress, pages) => {
      if (!controller.signal.aborted) {
        setPoints(progress);
        setPagesFetched(pages);
      }
    }).then((result) => {
      if (controller.signal.aborted) return;
      setPoints(result.points);
      setPagesFetched(result.pagesFetched);
      setComplete(result.complete);
      setWarnings(result.warnings);
      setPhase('ready');
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : 'Could not load price data.');
      setPhase('error');
    });
    return () => controller.abort();
  }, [range, refreshKey]);

  const latest = points.at(-1);
  const previous = points.at(-2);
  const buyExtreme = useMemo(() => extrema(points, 'buy'), [points]);
  const sellExtreme = useMemo(() => extrema(points, 'sell'), [points]);
  const recentRows = [...points].reverse().slice(0, 8);
  const isPartial = points.length > 0 && phase !== 'loading' && !complete;

  function choosePeriod(days: number) {
    const to = tehranToday();
    const next = { from: daysBefore(to, days - 1), to };
    setDraft(next);
    setRange(next);
    setPeriod(days);
    setFilterError(null);
  }

  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidDate(draft.from) || !isValidDate(draft.to)) {
      setFilterError('Enter valid Gregorian dates for both fields.');
      return;
    }
    if (draft.from > draft.to) {
      setFilterError('The start date must be on or before the end date.');
      return;
    }
    setFilterError(null);
    setPeriod(null);
    setRange({ ...draft });
    if (draft.from === range.from && draft.to === range.to) setRefreshKey((key) => key + 1);
  }

  return (
    <div className="app-shell">
      <div className="topline" />
      <header className="site-header">
        <div className="container header-inner">
          <div className="brand">
            <div className="brand-mark"><img src="/logo.jpeg" alt="Birs logo" /></div>
            <div><strong>Birs</strong><small>PRICE INTELLIGENCE</small></div>
          </div>
          <div className="header-meta">
            <span className="header-market"><span className="live-dot" /> Tehran cash market</span>
            <a href="https://t.me/birs_tomorrow" target="_blank" rel="noreferrer" className="header-source">
              Telegram source <ExternalLink size={15} />
            </a>
          </div>
        </div>
      </header>

      <main className="container main-content">
        <section className="page-intro">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> MARKET OVERVIEW / TEHRAN</div>
            <h1>Birs price dashboard</h1>
            <p>Track published buy and sell rates, with highs and lows for any date range.</p>
          </div>
          <div className={`data-state ${isOffline ? 'is-offline' : phase === 'loading' ? 'is-loading' : phase === 'error' ? 'is-error' : complete ? 'is-ready' : 'is-partial'}`}>
            {phase === 'loading' ? <RefreshCw size={17} className="spin" /> : phase === 'error' ? <CircleAlert size={17} /> : complete ? <Check size={17} /> : <CircleAlert size={17} />}
            {isOffline ? 'Offline · saved ranges only' : phase === 'loading' ? 'Loading rates' : phase === 'error' ? 'Data unavailable' : complete ? 'History complete' : 'Partial history'}
          </div>
        </section>

        <Card className="filter-card">
          <Card.Content className="filter-content">
            <div className="filter-heading">
              <div className="section-heading"><span className="section-icon"><CalendarDays size={19} /></span><div><h2>Report period</h2><p>Gregorian dates · Tehran time</p></div></div>
              <div className="quick-periods" aria-label="Quick date ranges">
                {[7, 30, 90].map((days) => (
                  <Button key={days} size="sm" variant={period === days ? 'primary' : 'tertiary'} isDisabled={phase === 'loading'} onPress={() => choosePeriod(days)} className="period-button">
                    Last {number(days)} days
                  </Button>
                ))}
              </div>
            </div>
            <form className="filter-form" onSubmit={applyFilter}>
              <label className="date-field"><span>From</span><Input aria-label="From date" type="date" value={draft.from} onChange={(event) => setDraft((old) => ({ ...old, from: event.target.value }))} className="date-input" /></label>
              <label className="date-field"><span>To</span><Input aria-label="To date" type="date" value={draft.to} onChange={(event) => setDraft((old) => ({ ...old, to: event.target.value }))} className="date-input" /></label>
              <Button type="submit" variant="primary" isDisabled={phase === 'loading'} className="apply-button">Apply dates <ChevronRight size={17} /></Button>
            </form>
            {filterError && <p className="form-error" role="alert">{filterError}</p>}
          </Card.Content>
        </Card>

        {error && <div className="message-box error-box" role="alert"><CircleAlert size={19} /><div><strong>Price data could not be loaded.</strong><span>{error}</span></div><Button size="sm" variant="secondary" onPress={() => setRefreshKey((key) => key + 1)}>Retry</Button></div>}
        {isPartial && <div className="message-box warning-box" role="status"><CircleAlert size={19} /><div><strong>Some history is unavailable.</strong><span>The chart and statistics use {number(points.length)} available posts.{warnings.length ? ` ${warnings.join(' ')}` : ''}</span></div></div>}

        <section className="metrics-grid" aria-label="Latest rates in range">
          <PriceCard label="Buy rate" value={latest?.buy} previous={previous?.buy} tone="buy" icon={<ArrowDownLeft size={20} />} />
          <PriceCard label="Sell rate" value={latest?.sell} previous={previous?.sell} tone="sell" icon={<ArrowUpRight size={20} />} />
          <PriceCard label="Sell–buy spread" value={latest?.spread} previous={previous?.spread} tone="spread" icon={<Activity size={20} />} />
        </section>

        <div className="content-grid">
          <Card className="chart-card">
            <Card.Content className="chart-content">
              <div className="card-heading chart-heading">
                <div><span className="kicker">PRICE TREND</span><h2>Price history</h2><p>Published rates in the selected period</p></div>
                <div className="chart-actions">
                  <div className="view-switch" aria-label="Price series">
                    {([['both', 'Both'], ['buy', 'Buy'], ['sell', 'Sell']] as const).map(([key, label]) => (
                      <button key={key} type="button" className={view === key ? 'active' : ''} onClick={() => setView(key)} aria-pressed={view === key}>{label}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="chart-legend"><span><i className="legend-dot buy" /> Buy</span><span><i className="legend-dot sell" /> Sell</span></div>
              <div className="chart-frame">
                {points.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={points} margin={{ top: 16, right: 4, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="buyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d8f80" stopOpacity={0.18} /><stop offset="95%" stopColor="#0d8f80" stopOpacity={0} /></linearGradient>
                        <linearGradient id="sellFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c77b5a" stopOpacity={0.12} /><stop offset="95%" stopColor="#c77b5a" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#30343c" strokeDasharray="4 5" />
                      <XAxis dataKey="timestamp_ms" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(value: number) => chartDate.format(new Date(value))} tick={{ fill: '#8fa3b4', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={45} />
                      <YAxis tickFormatter={(value: number) => number(value)} tick={{ fill: '#8fa3b4', fontSize: 11 }} axisLine={false} tickLine={false} width={48} orientation="right" domain={['auto', 'auto']} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#9bb6b3', strokeDasharray: '4 4' }} />
                      {(view === 'both' || view === 'buy') && <Area name="Buy" type="monotone" dataKey="buy" stroke="#42c8b0" strokeWidth={2.7} fill="url(#buyFill)" dot={false} activeDot={{ r: 5, fill: '#42c8b0', stroke: '#13283a', strokeWidth: 2 }} isAnimationActive={false} />}
                      {(view === 'both' || view === 'sell') && <Area name="Sell" type="monotone" dataKey="sell" stroke="#e2a078" strokeWidth={2.5} fill="url(#sellFill)" dot={false} activeDot={{ r: 5, fill: '#e2a078', stroke: '#13283a', strokeWidth: 2 }} isAnimationActive={false} />}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <div className="empty-chart"><BarChart3 size={32} /><strong>{phase === 'loading' ? 'Preparing chart…' : 'No rates found for this period'}</strong><span>{phase === 'loading' ? 'Reading the public channel history' : 'Choose another period or check the data source.'}</span></div>}
              </div>
              <div className="chart-footer"><span>Each point represents one post with buy and sell rates.</span><span>{number(points.length)} records · {number(pagesFetched)} pages</span></div>
            </Card.Content>
          </Card>
          <aside className="sidebar-stats">
            <div className="side-heading"><span className="kicker">RANGE STATISTICS</span><h2>Highs & lows</h2></div>
            <ExtremeCard title="Buy rate" tone="buy" min={buyExtreme.min} max={buyExtreme.max} />
            <ExtremeCard title="Sell rate" tone="sell" min={sellExtreme.min} max={sellExtreme.max} />
            <div className="source-note"><Activity size={17} /><span>Dates use Tehran time. Rate values are shown exactly as published by the channel.</span></div>
          </aside>
        </div>

        <Card className="history-card">
          <Card.Content className="history-content">
            <div className="card-heading history-heading"><div><span className="kicker">MARKET DETAIL</span><h2>Latest published rates</h2><p>{latest ? `Last update: ${latestTime(latest.time)}` : 'No rates loaded yet'}</p></div><Button size="sm" variant="secondary" isDisabled={points.length === 0} onPress={() => downloadCsv(points)}><Download size={16} /> Export CSV</Button></div>
            <div className="table-wrap"><table><thead><tr><th>Date & time</th><th>Buy</th><th>Sell</th><th>Spread</th><th>Source</th></tr></thead><tbody>{recentRows.length ? recentRows.map((point) => <tr key={point.message_id}><td>{latestTime(point.time)}</td><td className="table-buy">{number(point.buy)}</td><td className="table-sell">{number(point.sell)}</td><td>{number(point.spread)}</td><td><a href={point.message_url} target="_blank" rel="noreferrer" aria-label={`View post ${point.message_id}`}><ExternalLink size={16} /></a></td></tr>) : <tr><td colSpan={5} className="empty-row">No rates to display.</td></tr>}</tbody></table></div>
            {points.length > recentRows.length && <p className="table-footnote">Showing the latest {number(recentRows.length)} posts. Export CSV for all {number(points.length)} records.</p>}
          </Card.Content>
        </Card>
      </main>
      <footer className="site-footer"><div className="container footer-inner"><span>Birs · Tehran cash market dashboard</span><span>Data from the public preview of <a href="https://t.me/birs_tomorrow" target="_blank" rel="noreferrer">@birs_tomorrow</a>.</span></div></footer>
    </div>
  );
}

export default App;
