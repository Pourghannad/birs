import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Card, Input } from '@heroui/react';
import {
  Activity, ArrowDownLeft, ArrowUpRight, BarChart3, CalendarDays,
  Check, ChevronLeft, CircleAlert, Download, ExternalLink, RefreshCw,
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
const digits = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });
const shortDate = new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Tehran',
});
const chartDate = new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
  month: 'short', day: 'numeric', timeZone: 'Asia/Tehran',
});
const fullDate = new Intl.DateTimeFormat('fa-IR-u-ca-gregory', {
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
  if (!value) return 'هنوز داده‌ای ثبت نشده است';
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
          <span className="metric-unit">طبق کانال</span>
        </div>
        <div className="metric-bottom">
          <span>آخرین نرخ در بازه</span>
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
          <span className="subtle-label">در بازهٔ انتخابی</span>
        </div>
        <div className="extreme-grid">
          <div className="extreme-item">
            <div className="extreme-heading"><TrendingUp size={16} /> بیشترین</div>
            <strong dir="ltr">{number(max?.[tone])}</strong>
            {max ? <a href={max.message_url} target="_blank" rel="noreferrer" title="نمایش پیام منبع">
              {dateLabel(max.date)} <ExternalLink size={13} />
            </a> : <span>—</span>}
          </div>
          <div className="extreme-item">
            <div className="extreme-heading"><TrendingDown size={16} /> کمترین</div>
            <strong dir="ltr">{number(min?.[tone])}</strong>
            {min ? <a href={min.message_url} target="_blank" rel="noreferrer" title="نمایش پیام منبع">
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
    <div className="chart-tooltip" dir="rtl">
      <div className="tooltip-date">{latestTime(point.time)}</div>
      <div className="tooltip-line"><span className="legend-dot buy" /> خرید <b dir="ltr">{number(point.buy)}</b></div>
      <div className="tooltip-line"><span className="legend-dot sell" /> فروش <b dir="ltr">{number(point.sell)}</b></div>
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
      setError(cause instanceof Error ? cause.message : 'دریافت داده با خطا روبه‌رو شد.');
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
      setFilterError('هر دو تاریخ باید میلادی و معتبر باشند.');
      return;
    }
    if (draft.from > draft.to) {
      setFilterError('تاریخ شروع باید پیش از تاریخ پایان باشد.');
      return;
    }
    setFilterError(null);
    setPeriod(null);
    setRange({ ...draft });
    if (draft.from === range.from && draft.to === range.to) setRefreshKey((key) => key + 1);
  }

  return (
    <div className="app-shell" dir="rtl">
      <div className="topline" />
      <header className="site-header">
        <div className="container header-inner">
          <div className="brand">
            <div className="brand-mark"><BarChart3 size={23} strokeWidth={2.4} /></div>
            <div><strong>بیرس</strong><small>سامانه پایش قیمت</small></div>
          </div>
          <div className="header-meta">
            <span className="header-market"><span className="live-dot" /> بازار نقدی تهران</span>
            <a href="https://t.me/birs_tomorrow" target="_blank" rel="noreferrer" className="header-source">
              منبع داده <ExternalLink size={15} />
            </a>
          </div>
        </div>
      </header>

      <main className="container main-content">
        <section className="page-intro">
          <div>
            <div className="eyebrow"><span className="eyebrow-line" /> گزارش بازار / بیرس نقدی تهران</div>
            <h1>گزارش قیمت بیرس</h1>
            <p>روند نرخ خرید و فروش، همراه با بیشترین و کمترین قیمت ثبت‌شده در بازهٔ دلخواه شما.</p>
          </div>
          <div className={`data-state ${phase === 'loading' ? 'is-loading' : phase === 'error' ? 'is-error' : complete ? 'is-ready' : 'is-partial'}`}>
            {phase === 'loading' ? <RefreshCw size={17} className="spin" /> : phase === 'error' ? <CircleAlert size={17} /> : complete ? <Check size={17} /> : <CircleAlert size={17} />}
            {phase === 'loading' ? 'در حال دریافت داده' : phase === 'error' ? 'خطا در دریافت' : complete ? 'دادهٔ قابل مشاهده کامل' : 'دادهٔ ناقص'}
          </div>
        </section>

        <Card className="filter-card">
          <Card.Content className="filter-content">
            <div className="filter-heading">
              <div className="section-heading"><span className="section-icon"><CalendarDays size={19} /></span><div><h2>بازهٔ گزارش</h2><p>تاریخ میلادی، به وقت تهران</p></div></div>
              <div className="quick-periods" aria-label="بازه‌های آماده">
                {[7, 30, 90].map((days) => (
                  <Button key={days} size="sm" variant={period === days ? 'primary' : 'tertiary'} isDisabled={phase === 'loading'} onPress={() => choosePeriod(days)} className="period-button">
                    {number(days)} روز اخیر
                  </Button>
                ))}
              </div>
            </div>
            <form className="filter-form" onSubmit={applyFilter}>
              <label className="date-field"><span>از تاریخ</span><Input aria-label="از تاریخ" type="date" value={draft.from} onChange={(event) => setDraft((old) => ({ ...old, from: event.target.value }))} className="date-input" /></label>
              <label className="date-field"><span>تا تاریخ</span><Input aria-label="تا تاریخ" type="date" value={draft.to} onChange={(event) => setDraft((old) => ({ ...old, to: event.target.value }))} className="date-input" /></label>
              <Button type="submit" variant="primary" isDisabled={phase === 'loading'} className="apply-button">نمایش گزارش <ChevronLeft size={17} /></Button>
            </form>
            {filterError && <p className="form-error" role="alert">{filterError}</p>}
          </Card.Content>
        </Card>

        {error && <div className="message-box error-box" role="alert"><CircleAlert size={19} /><div><strong>دریافت اطلاعات ممکن نشد.</strong><span>{error}</span></div><Button size="sm" variant="secondary" onPress={() => setRefreshKey((key) => key + 1)}>تلاش دوباره</Button></div>}
        {isPartial && <div className="message-box warning-box" role="status"><CircleAlert size={19} /><div><strong>بخشی از تاریخچه در دسترس نبود.</strong><span>آمار و نمودار فقط بر اساس {number(points.length)} پیام دریافت‌شده نمایش داده می‌شود.{warnings.length ? ` ${warnings.join(' ')}` : ''}</span></div></div>}

        <section className="metrics-grid" aria-label="آخرین نرخ‌ها در بازه">
          <PriceCard label="نرخ خرید" value={latest?.buy} previous={previous?.buy} tone="buy" icon={<ArrowDownLeft size={20} />} />
          <PriceCard label="نرخ فروش" value={latest?.sell} previous={previous?.sell} tone="sell" icon={<ArrowUpRight size={20} />} />
          <PriceCard label="اختلاف فروش و خرید" value={latest?.spread} previous={previous?.spread} tone="spread" icon={<Activity size={20} />} />
        </section>

        <div className="content-grid">
          <Card className="chart-card">
            <Card.Content className="chart-content">
              <div className="card-heading chart-heading">
                <div><span className="kicker">تحلیل روند</span><h2>نمودار تغییرات قیمت</h2><p>نرخ‌های منتشرشده در بازهٔ انتخابی</p></div>
                <div className="chart-actions">
                  <div className="view-switch" aria-label="نمایش سری قیمت">
                    {([['both', 'هر دو'], ['buy', 'خرید'], ['sell', 'فروش']] as const).map(([key, label]) => (
                      <button key={key} type="button" className={view === key ? 'active' : ''} onClick={() => setView(key)} aria-pressed={view === key}>{label}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="chart-legend"><span><i className="legend-dot buy" /> خرید</span><span><i className="legend-dot sell" /> فروش</span></div>
              <div className="chart-frame">
                {points.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={points} margin={{ top: 16, right: 4, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="buyFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0d8f80" stopOpacity={0.18} /><stop offset="95%" stopColor="#0d8f80" stopOpacity={0} /></linearGradient>
                        <linearGradient id="sellFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c77b5a" stopOpacity={0.12} /><stop offset="95%" stopColor="#c77b5a" stopOpacity={0} /></linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} stroke="#e9eef0" strokeDasharray="4 5" />
                      <XAxis dataKey="timestamp_ms" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={(value: number) => chartDate.format(new Date(value))} tick={{ fill: '#8b9ba4', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={45} />
                      <YAxis tickFormatter={(value: number) => number(value)} tick={{ fill: '#8b9ba4', fontSize: 11 }} axisLine={false} tickLine={false} width={48} orientation="right" domain={['auto', 'auto']} />
                      <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#9bb6b3', strokeDasharray: '4 4' }} />
                      {(view === 'both' || view === 'buy') && <Area name="خرید" type="monotone" dataKey="buy" stroke="#0d8f80" strokeWidth={2.7} fill="url(#buyFill)" dot={false} activeDot={{ r: 5, fill: '#0d8f80', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />}
                      {(view === 'both' || view === 'sell') && <Area name="فروش" type="monotone" dataKey="sell" stroke="#c77b5a" strokeWidth={2.5} fill="url(#sellFill)" dot={false} activeDot={{ r: 5, fill: '#c77b5a', stroke: '#fff', strokeWidth: 2 }} isAnimationActive={false} />}
                    </AreaChart>
                  </ResponsiveContainer>
                ) : <div className="empty-chart"><BarChart3 size={32} /><strong>{phase === 'loading' ? 'در حال آماده‌سازی نمودار…' : 'داده‌ای برای این بازه پیدا نشد'}</strong><span>{phase === 'loading' ? 'در حال خواندن تاریخچهٔ عمومی کانال' : 'بازهٔ دیگری انتخاب کنید یا منبع داده را بررسی کنید.'}</span></div>}
              </div>
              <div className="chart-footer"><span>هر نقطه نشان‌دهندهٔ یک پیام دارای نرخ خرید و فروش است.</span><span>{number(points.length)} رکورد · {number(pagesFetched)} صفحه</span></div>
            </Card.Content>
          </Card>
          <aside className="sidebar-stats">
            <div className="side-heading"><span className="kicker">آمار بازه</span><h2>بیشینه و کمینه</h2></div>
            <ExtremeCard title="قیمت خرید" tone="buy" min={buyExtreme.min} max={buyExtreme.max} />
            <ExtremeCard title="قیمت فروش" tone="sell" min={sellExtreme.min} max={sellExtreme.max} />
            <div className="source-note"><Activity size={17} /><span>تاریخ‌ها به وقت تهران است. واحد قیمت مطابق عدد منتشرشده در کانال نمایش داده می‌شود.</span></div>
          </aside>
        </div>

        <Card className="history-card">
          <Card.Content className="history-content">
            <div className="card-heading history-heading"><div><span className="kicker">جزئیات بازار</span><h2>آخرین نرخ‌های ثبت‌شده</h2><p>{latest ? `آخرین به‌روزرسانی: ${latestTime(latest.time)}` : 'هنوز داده‌ای دریافت نشده است'}</p></div><Button size="sm" variant="secondary" isDisabled={points.length === 0} onPress={() => downloadCsv(points)}><Download size={16} /> دریافت CSV</Button></div>
            <div className="table-wrap"><table><thead><tr><th>تاریخ و زمان</th><th>خرید</th><th>فروش</th><th>اختلاف</th><th>منبع</th></tr></thead><tbody>{recentRows.length ? recentRows.map((point) => <tr key={point.message_id}><td>{latestTime(point.time)}</td><td className="table-buy" dir="ltr">{number(point.buy)}</td><td className="table-sell" dir="ltr">{number(point.sell)}</td><td dir="ltr">{number(point.spread)}</td><td><a href={point.message_url} target="_blank" rel="noreferrer" aria-label={`نمایش پیام ${point.message_id}`}><ExternalLink size={16} /></a></td></tr>) : <tr><td colSpan={5} className="empty-row">داده‌ای برای نمایش وجود ندارد.</td></tr>}</tbody></table></div>
            {points.length > recentRows.length && <p className="table-footnote">جدول، {number(recentRows.length)} پیام آخر را نشان می‌دهد. همهٔ {number(points.length)} رکورد در فایل CSV قابل دریافت است.</p>}
          </Card.Content>
        </Card>
      </main>
      <footer className="site-footer"><div className="container footer-inner"><span>بیرس · داشبورد پایش بازار نقدی تهران</span><span>داده‌ها از پیش‌نمایش عمومی <a href="https://t.me/birs_tomorrow" target="_blank" rel="noreferrer">کانال بیرس فردایی</a> خوانده می‌شوند.</span></div></footer>
    </div>
  );
}

export default App;
