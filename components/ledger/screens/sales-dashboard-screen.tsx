'use client';

// 매출 대시보드 — 본사·마스터 전용 숨김 화면 (메뉴에 없음, 홈 매출 요약 '대시보드 ›'로 진입)
// 파워BI Weekly Report 배치: 왼쪽 필터 · KPI 5칸 · 4칸(매장별/일별/공급구분/시간대별) · 맨 아래 상품
import { useEffect, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useRole } from '../role-context';
import { SALES_STORES, won } from '@/lib/ledger/sales-summary';
import { parseYmd, todayYmd } from '@/lib/ledger/calendar';
import { isHqRole } from '@/lib/ledger/roles';
import {
  DashboardData,
  Period,
  StoreFilter,
  SUPPLY_TYPES,
  achievement,
  defaultWeek,
  loadSalesDashboard,
  shiftWeek,
  weekOf,
} from '@/lib/ledger/sales-dashboard';

const WD = ['일', '월', '화', '수', '목', '금', '토'];
const WD_MON = ['월', '화', '수', '목', '금', '토', '일'];
const C_BAR = '#f97316'; // 매출 막대
const C_BAR2 = '#fbbf24'; // 일별 막대 (파워BI 옐로)
const C_LINE = '#171717'; // 고객수 선
const C_PREV = '#a3a3a3'; // 전주 점선
const SUPPLY_COLORS: Record<string, string> = { 자사: '#f97316', 위탁: '#fbbf24', 사입: '#c2410c', 미분류: '#d4d4d4' };
const SHORT: Record<string, string> = { samcheong: '삼청점', commons: '커먼즈행궁', toyhouse: '토이하우스' };

function md(s: string) {
  const d = parseYmd(s);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}
function mdw(s: string) {
  return `${md(s)}(${WD[parseYmd(s).getDay()]})`;
}
function weekLabel(p: Period, today: string) {
  const tag = p.start === weekOf(today).start ? ' 이번 주' : p.start === shiftWeek(weekOf(today), -1).start ? ' 지난주' : '';
  return { range: `${md(p.start)} ~ ${md(p.end)}`, tag };
}
// 축·라벨용 축약 (파워BI처럼 백만/만)
function short(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}백만`;
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ko-KR')}만`;
  return Math.round(n).toLocaleString('ko-KR');
}
const num = (n: number) => Math.round(n).toLocaleString('ko-KR');
const tipWon = (v: unknown) => (typeof v === 'number' ? won(v) : '—');

function Card({ title, sub, right, children, className }: { title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`lg-card sd-card${className ? ` ${className}` : ''}`}>
      <div className="sd-card-h">
        <span className="sd-card-t">{title}</span>
        {sub && <span className="sd-card-sub">{sub}</span>}
        {right && <span className="sd-card-r">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="sd-kpi">
      <div className="sd-kv">{value}</div>
      <div className="sd-kl">{label}</div>
      {sub && <div className="sd-ks">{sub}</div>}
    </div>
  );
}

const Pending = ({ what }: { what: string }) => <p className="sd-pending">{what} — 영수증 데이터(pos_receipts) 저장 후 표시돼요</p>;

// ── 차트 ─────────────────────────────────────────────────────────────

function StoreChart({ data }: { data: DashboardData }) {
  const rows = data.stores.map((s) => ({ name: SHORT[s.key] ?? s.name, total: s.total, customers: s.customers }));
  const hasCust = data.stores.some((s) => s.customers !== null);
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#f0f0f0" />
        <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis yAxisId="l" tickFormatter={short} tickLine={false} axisLine={false} fontSize={11} width={52} />
        {hasCust && <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={40} />}
        <Tooltip formatter={(v, n) => (n === '고객수' ? `${num(Number(v))}명` : tipWon(v))} />
        <Legend verticalAlign="bottom" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} yAxisId="l" dataKey="total" name="총매출액" fill={C_BAR} radius={[4, 4, 0, 0]} maxBarSize={80}>
          <LabelList dataKey="total" position="top" formatter={(v: unknown) => short(Number(v))} fontSize={11} />
        </Bar>
        {hasCust && <Line isAnimationActive={false} yAxisId="r" dataKey="customers" name="고객수" stroke={C_LINE} strokeWidth={2} dot={{ r: 3 }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function DailyChart({ data }: { data: DashboardData }) {
  const rows = data.days.map((d) => ({ ...d, label: mdw(d.date) }));
  const hasCust = data.days.some((d) => d.customers !== null);
  const hasPrev = data.days.some((d) => d.prevTotal !== null);
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#f0f0f0" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
        <YAxis yAxisId="l" tickFormatter={short} tickLine={false} axisLine={false} fontSize={11} width={52} />
        {hasCust && <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={40} />}
        <Tooltip formatter={(v, n) => (n === '고객수' ? `${num(Number(v))}명` : tipWon(v))} />
        <Legend verticalAlign="bottom" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} yAxisId="l" dataKey="total" name="총매출액" fill={C_BAR2} radius={[4, 4, 0, 0]} maxBarSize={48}>
          <LabelList dataKey="total" position="top" formatter={(v: unknown) => (v == null ? '' : short(Number(v)))} fontSize={11} />
        </Bar>
        {hasPrev && (
          <Line isAnimationActive={false} yAxisId="l" dataKey="prevTotal" name="전주 매출" stroke={C_PREV} strokeDasharray="5 4" strokeWidth={2} dot={false} connectNulls />
        )}
        {hasCust && <Line isAnimationActive={false} yAxisId="r" dataKey="customers" name="고객수" stroke={C_LINE} strokeWidth={2} dot={{ r: 3 }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function SupplyDonut({ data, picked }: { data: DashboardData; picked: string[] }) {
  const rows = data.product.supply;
  const total = data.product.total;
  if (!rows.length) return <p className="sd-pending">이 주의 상품별 판매 데이터가 아직 올라오지 않았어요</p>;
  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={rows}
          dataKey="amount"
          nameKey="type"
          innerRadius="52%"
          outerRadius="78%"
          paddingAngle={1}
          label={({ value }) => (total ? `${((Number(value) / total) * 100).toFixed(1)}%` : '')}
          labelLine={false}
          isAnimationActive={false}
        >
          {rows.map((r) => (
            <Cell key={r.type} fill={SUPPLY_COLORS[r.type] ?? '#e5e5e5'} opacity={picked.length && !picked.includes(r.type) ? 0.25 : 1} />
          ))}
        </Pie>
        <Tooltip formatter={tipWon} />
        <Legend verticalAlign="bottom" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function HourChart({ data }: { data: NonNullable<DashboardData['receipts']> }) {
  const rows = data.hours.map((h) => ({ ...h, label: `${h.hour}시` }));
  const hasPrev = data.hours.some((h) => h.prevNet !== null);
  return (
    <ResponsiveContainer width="100%" height={250}>
      <ComposedChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="#f0f0f0" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval={0} />
        <YAxis yAxisId="l" tickFormatter={short} tickLine={false} axisLine={false} fontSize={11} width={52} />
        <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} fontSize={11} width={40} />
        <Tooltip formatter={(v, n) => (n === '고객수' ? `${num(Number(v))}명` : tipWon(v))} />
        <Legend verticalAlign="bottom" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
        <Bar isAnimationActive={false} yAxisId="l" dataKey="net" name="실매출액" fill={C_BAR} radius={[3, 3, 0, 0]} />
        {hasPrev && <Line isAnimationActive={false} yAxisId="l" dataKey="prevNet" name="전주 실매출" stroke={C_PREV} strokeDasharray="5 4" strokeWidth={2} dot={false} />}
        <Line isAnimationActive={false} yAxisId="r" dataKey="customers" name="고객수" stroke={C_LINE} strokeWidth={2} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// 요일×시간대 히트맵 — 진할수록 실매출 높음 (Recharts에 히트맵이 없어 CSS 그리드)
function HourHeatmap({ data }: { data: NonNullable<DashboardData['receipts']> }) {
  const hours = data.hours.map((h) => h.hour);
  const max = Math.max(1, ...data.heat.map((c) => c.net));
  const top = data.heat.reduce((b, c) => (c.net > b.net ? c : b), data.heat[0]);
  return (
    <div className="sd-heat-wrap">
      <div className="sd-heat" style={{ gridTemplateColumns: `28px repeat(${hours.length}, minmax(0, 1fr))` }}>
        <span />
        {hours.map((h) => (
          <span key={h} className="sd-heat-x">
            {h}
          </span>
        ))}
        {WD_MON.map((w, wi) => (
          <div key={w} className="sd-heat-row">
            <span className="sd-heat-y">{w}</span>
            {hours.map((h) => {
              const c = data.heat.find((x) => x.weekday === wi && x.hour === h)!;
              const a = c.net > 0 ? 0.08 + 0.92 * (c.net / max) : 0;
              return (
                <span
                  key={h}
                  className="sd-heat-c"
                  style={{ background: a ? `rgba(234, 88, 12, ${a.toFixed(3)})` : undefined }}
                  title={`${w} ${h}시 · ${won(c.net)} · ${num(c.customers)}명`}
                />
              );
            })}
          </div>
        ))}
      </div>
      {top && top.net > 0 && (
        <p className="sd-heat-note">
          가장 붐빈 시간 <b>{WD_MON[top.weekday]} {top.hour}시</b> · {won(top.net)} · {num(top.customers)}명
        </p>
      )}
    </div>
  );
}

function TopProducts({ data, picked }: { data: DashboardData; picked: string[] }) {
  const list = data.product.ranks.filter((p) => !picked.length || picked.includes(p.supplyType)).slice(0, 10);
  if (!list.length) return <p className="sd-pending">이 주의 상품별 판매 데이터가 아직 올라오지 않았어요</p>;
  const max = Math.max(1, ...list.map((p) => p.amount));
  return (
    <table className="sd-table sd-top">
      <thead>
        <tr>
          <th>#</th>
          <th>상품명</th>
          <th>구분</th>
          <th className="num">판매 수량</th>
          <th className="sd-top-bar-h">총 매출액</th>
        </tr>
      </thead>
      <tbody>
        {list.map((p, i) => (
          <tr key={`${p.sku}-${i}`}>
            <td className="sd-dim">{i + 1}</td>
            <td className="sd-name" title={p.sku}>
              {p.name}
            </td>
            <td className="sd-dim">{p.supplyType}</td>
            <td className="num">{num(p.qty)}</td>
            <td className="sd-top-bar">
              <span className="sd-top-track">
                <span style={{ width: `${(p.amount / max) * 100}%`, background: SUPPLY_COLORS[p.supplyType] ?? C_BAR }} />
              </span>
              <b>{won(p.amount)}</b>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 화면 ─────────────────────────────────────────────────────────────

export function SalesDashboardScreen() {
  const { role } = useRole();
  const today = todayYmd();
  const [period, setPeriod] = useState<Period>(() => defaultWeek(today));
  const [store, setStore] = useState<StoreFilter>('all');
  const [picked, setPicked] = useState<string[]>([]); // 공급구분 (비어 있으면 전체)
  const [hourView, setHourView] = useState<'bar' | 'heat'>('bar');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const allowed = isHqRole(role);

  useEffect(() => {
    if (!allowed) return;
    let alive = true;
    setLoading(true);
    setErr('');
    loadSalesDashboard(period, store, today)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setErr((e as Error)?.message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [period, store, today, allowed]);

  if (!allowed) return <div className="lg-card lg-empty">본사·마스터 계정만 볼 수 있는 화면입니다.</div>;

  const nextDisabled = shiftWeek(period, 1).start > today;
  const wl = weekLabel(period, today);
  const togglePick = (t: string) => setPicked((p) => (p.includes(t) ? p.filter((x) => x !== t) : [...p, t]));
  const rc = data?.receipts ?? null;
  const rcReady = !!rc?.coveredTo;
  const excluded = data?.stores.filter((s) => !s.comparable) ?? [];
  const ach = data ? achievement(data.cmpTotal, data.cmpPrevTotal) : null;

  return (
    <div className="sd">
      <aside className="sd-side">
        <div className="sd-side-box">
          <div className="sd-side-l">주차</div>
          <div className="sd-week">
            <button type="button" onClick={() => setPeriod(shiftWeek(period, -1))} aria-label="이전 주">
              ◀
            </button>
            <span>
              {wl.range}
              {wl.tag && <small>{wl.tag}</small>}
            </span>
            <button type="button" onClick={() => setPeriod(shiftWeek(period, 1))} disabled={nextDisabled} aria-label="다음 주">
              ▶
            </button>
          </div>
        </div>
        <div className="sd-side-l">공급구분</div>
        {SUPPLY_TYPES.map((t) => (
          <button key={t} type="button" className={`sd-side-btn${picked.includes(t) ? ' on' : ''}`} onClick={() => togglePick(t)}>
            {t}
          </button>
        ))}
        <div className="sd-side-l">매장</div>
        {[{ key: 'all', label: '전체' }, ...SALES_STORES.map((s) => ({ key: s.key, label: SHORT[s.key] ?? s.name }))].map((s) => (
          <button
            key={s.key}
            type="button"
            className={`sd-side-btn${store === s.key ? ' on' : ''}`}
            onClick={() => setStore(s.key as StoreFilter)}
          >
            {s.label}
          </button>
        ))}
        <p className="sd-side-note">
          매출 ~{data?.cutoff ? md(data.cutoff) : '—'}
          <br />
          영수증 ~{rc?.coveredTo ? md(rc.coveredTo) : '—'}
          <br />
          상품 ~{data?.product.coveredTo ? md(data.product.coveredTo) : '—'}
        </p>
      </aside>

      <div className="sd-main">
        <h2 className="sd-title">
          Weekly Report <span>{wl.range}</span>
        </h2>
        {err ? (
          <div className="lg-card lg-empty lg-err">매출을 불러오지 못했습니다. ({err})</div>
        ) : !data ? (
          <div className="lg-card lg-empty">불러오는 중…</div>
        ) : !data.cutoff ? (
          <div className="lg-card lg-empty">이 주에는 자동수집된 매출이 없습니다.</div>
        ) : (
          <div className={loading ? 'sd-loading' : undefined}>
            <div className="sd-kpis">
              <Kpi label="총 매출액" value={won(data.total)} sub="기기 매출 포함" />
              <Kpi label="총 실매출액" value={rcReady ? won(data.total - rc!.discount) : '—'} sub={rcReady ? `할인 ${won(rc!.discount)} 차감` : '영수증 저장 후'} />
              <Kpi label="객단가" value={rcReady && rc!.customers ? won(rc!.net / rc!.customers) : '—'} sub="POS 영수증 기준" />
              <Kpi label="총 고객수(명)" value={rcReady ? num(rc!.customers) : '—'} sub="결제 − 취소" />
              <Kpi
                label="전주대비 달성률"
                value={ach === null ? '—' : `${Math.round(ach)}%`}
                sub={excluded.length ? `${excluded.map((s) => SHORT[s.key]).join('·')} 비교 제외` : `전주 ${short(data.cmpPrevTotal)}`}
              />
            </div>

            <div className="sd-grid">
              <Card title="매장별 매출 · 고객수" sub={rcReady ? undefined : '고객수는 영수증 저장 후'}>
                <StoreChart data={data} />
              </Card>
              <Card title="일별 매출 · 고객수" sub="회색 점선 = 전주 같은 요일">
                <DailyChart data={data} />
              </Card>
              <Card title="공급구분 비중" sub={data.product.coveredTo ? `상품 데이터 ~${md(data.product.coveredTo)}` : undefined}>
                <SupplyDonut data={data} picked={picked} />
              </Card>
              <Card
                title="시간대별 실매출 · 고객수"
                sub={hourView === 'heat' ? '요일 × 시간대' : rc?.hours.some((h) => h.prevNet !== null) ? '회색 점선 = 전주' : '전주 영수증 없음'}
                right={
                  <span className="sd-seg sd-seg-sm" role="group" aria-label="시간대 보기">
                    <button type="button" className={hourView === 'bar' ? 'on' : ''} onClick={() => setHourView('bar')}>
                      막대
                    </button>
                    <button type="button" className={hourView === 'heat' ? 'on' : ''} onClick={() => setHourView('heat')}>
                      히트맵
                    </button>
                  </span>
                }
              >
                {!rcReady ? <Pending what="시간대별" /> : hourView === 'bar' ? <HourChart data={rc!} /> : <HourHeatmap data={rc!} />}
              </Card>
            </div>

            <Card
              title="상품 TOP 10 — 매출 순"
              sub={`${picked.length ? picked.join('·') : '전체 공급구분'}${data.product.coveredTo ? ` · 상품 데이터 ~${md(data.product.coveredTo)}` : ''}`}
              className="sd-bottom"
            >
              <TopProducts data={data} picked={picked} />
            </Card>

            <p className="sl-note">
              총 매출액·매장별·일별 = 자동수집(POS + 토스 + 사진기·게임기) · 실매출·객단가·고객수·시간대 = 듀얼아이 영수증(매주 월요일 전주분) ·
              공급구분·TOP 상품 = POS 판매 업로드 · 공급구분 버튼은 상품 영역에만 적용 · 스모어 행궁점은 폐점으로 제외
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
