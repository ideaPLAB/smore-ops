// 매출 대시보드 (본사·마스터 전용 숨김 화면, 2026-09-29 나츠). 파워BI Weekly Report 모방 v2.
// 총 매출액·매장별·일별 = 자동수집 3테이블 (홈 매출 요약과 같은 합계 기준: amount + toss_amount, 기기 매출 포함)
// 고객수·객단가·할인·시간대별 = pos_receipts (듀얼아이 영수증, 매주 월요일 전주분 저장) — POS 기준만
// 공급구분·TOP 상품 = pos_sales_daily (POS 판매 업로드분) + products.supply_type
// 세 소스는 반영 시점이 달라서 화면에 각각의 기준일을 따로 보여준다.
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';
import { addDays, parseYmd, todayYmd } from './calendar';
import { SALES_STORES } from './sales-summary';

export type StoreKey = (typeof SALES_STORES)[number]['key'];
export type StoreFilter = StoreKey | 'all';

export interface Period {
  start: string; // 월요일
  end: string; // 일요일
}

const PAGE = 1000;
const ID_CHUNK = 150; // products id in(...) — URL 길이 제한
export const UNCLASSIFIED = '미분류';
export const SUPPLY_TYPES = ['자사', '위탁', '사입'] as const;
const SUPPLY_ORDER = [...SUPPLY_TYPES, UNCLASSIFIED];
const DEFAULT_HOURS: [number, number] = [10, 21];

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new SupabaseMissingError();
  return sb;
}

// ── 기간 (주 단위) ───────────────────────────────────────────────────

export function mondayOf(s: string): string {
  return addDays(s, -((parseYmd(s).getDay() + 6) % 7));
}

export function weekOf(anchor: string): Period {
  const start = mondayOf(anchor);
  return { start, end: addDays(start, 6) };
}

export function shiftWeek(p: Period, n: number): Period {
  return weekOf(addDays(p.start, 7 * n));
}

// 기본값 = 지난주(월~일)
export function defaultWeek(today = todayYmd()): Period {
  return weekOf(addDays(today, -7));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parseYmd(b).getTime() - parseYmd(a).getTime()) / 86400000);
}

export function datesIn(start: string, end: string): string[] {
  const n = daysBetween(start, end);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

const minYmd = (a: string, b: string) => (a < b ? a : b);
// 0=월 … 6=일
export const weekdayIdx = (s: string) => (parseYmd(s).getDay() + 6) % 7;
// 결제 시각(timestamptz) → KST 시
const kstHour = (iso: string) => (new Date(iso).getUTCHours() + 9) % 24;

// ── 조회 ─────────────────────────────────────────────────────────────

interface AutoRow {
  date: string;
  site_name: string;
  amount: number | null;
  toss_amount: number | null;
}

interface PosRow {
  sale_date: string;
  product_id: string;
  qty: number | null;
  amount: number | null;
}

interface ReceiptRow {
  store: string;
  sold_at: string;
  sale_date: string;
  net_amount: number | null;
  discount: number | null;
  is_cancel: boolean;
}

type PageFetch<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>;

async function fetchAll<T>(fetchPage: PageFetch<T>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

function autoRows(table: string, from: string, to: string) {
  return fetchAll<AutoRow>((a, b) =>
    client()
      .from(table)
      .select('date,site_name,amount,toss_amount')
      .gte('date', from)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('site_name', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b),
  );
}

async function earliestAutoDate(table: string): Promise<string | null> {
  const { data, error } = await client().from(table).select('date').order('date', { ascending: true }).limit(1);
  if (error) throw error;
  return (data?.[0] as { date: string } | undefined)?.date ?? null;
}

// pos_receipts 가 아직 없으면(테이블 생성 전) null — 영수증 기반 칸만 '준비 중'으로 표시
function isMissingTable(e: unknown) {
  const code = (e as { code?: string })?.code;
  return code === 'PGRST205' || code === '42P01';
}

async function receiptRows(stores: string[], from: string, to: string): Promise<ReceiptRow[] | null> {
  try {
    return await fetchAll<ReceiptRow>((a, b) =>
      client()
        .from('pos_receipts')
        .select('store,sold_at,sale_date,net_amount,discount,is_cancel')
        .in('store', stores)
        .gte('sale_date', from)
        .lte('sale_date', to)
        .order('sold_at', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b),
    );
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

async function locationIds(names: string[]): Promise<string[]> {
  const { data, error } = await client().from('locations').select('id,name').in('name', names);
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

function posRows(locIds: string[], from: string, to: string) {
  return fetchAll<PosRow>((a, b) =>
    client()
      .from('pos_sales_daily')
      .select('sale_date,product_id,qty,amount')
      .in('location_id', locIds)
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('sale_date', { ascending: true })
      .order('location_id', { ascending: true })
      .order('product_id', { ascending: true })
      .range(a, b),
  );
}

interface ProductInfo {
  id: string;
  sku: string;
  name: string;
  supply_type: string | null;
}

async function productsByIds(ids: string[]): Promise<Map<string, ProductInfo>> {
  const map = new Map<string, ProductInfo>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await client()
      .from('products')
      .select('id,sku,name,supply_type')
      .in('id', ids.slice(i, i + ID_CHUNK));
    if (error) throw error;
    for (const p of (data ?? []) as ProductInfo[]) map.set(p.id, p);
  }
  return map;
}

// ── 영수증 집계 ──────────────────────────────────────────────────────

// 고객수 = 결제 건수 − 취소 건수 (PRD 4장 정의). 실매출 0원 영수증(전액 할인·서비스)은 고객수에서 제외
// → 9/21~27 샘플 기준 2,132 − 24 = 2,108명으로 듀얼아이 집계와 일치
interface ReceiptAgg {
  net: number;
  discount: number;
  customers: number;
}

const emptyAgg = (): ReceiptAgg => ({ net: 0, discount: 0, customers: 0 });

function addReceipt(a: ReceiptAgg, r: ReceiptRow) {
  const net = r.net_amount ?? 0;
  a.net += net;
  a.discount -= r.discount ?? 0; // 듀얼아이 원본 부호: 할인 = 음수, 취소 시 되돌림 = 양수 → 합계를 뒤집어 양수로
  a.customers += r.is_cancel || net < 0 ? -1 : net > 0 ? 1 : 0;
}

function bump<K>(m: Map<K, ReceiptAgg>, k: K, r: ReceiptRow) {
  const a = m.get(k) ?? emptyAgg();
  addReceipt(a, r);
  m.set(k, a);
}

// ── 결과 타입 ────────────────────────────────────────────────────────

const rowTotal = (r: AutoRow) => (r.amount ?? 0) + (r.toss_amount ?? 0);

export interface StoreRow {
  key: StoreKey;
  name: string;
  total: number;
  prevTotal: number;
  customers: number | null; // 영수증 없으면 null
  since: string | null; // 이 매장 자동수집 시작일
  comparable: boolean; // 전주 전체가 수집 시작일 이후인지 (아니면 달성률 계산에서 제외)
}

export interface DayPoint {
  date: string;
  total: number | null; // 아직 수집 전이면 null
  prevTotal: number | null; // 전주 같은 요일
  customers: number | null;
}

export interface HourPoint {
  hour: number;
  net: number;
  customers: number;
  prevNet: number | null; // 전주 영수증 없으면 null
}

export interface HeatCell {
  weekday: number; // 0=월
  hour: number;
  net: number;
  customers: number;
}

export interface ProductRank {
  sku: string;
  name: string;
  supplyType: string;
  qty: number;
  amount: number;
}

export interface DashboardData {
  period: Period;
  cutoff: string | null; // 이번 주 자동수집 마지막 날
  total: number;
  // 달성률용: 전주 비교 가능한 매장만 합산
  cmpTotal: number;
  cmpPrevTotal: number;
  stores: StoreRow[];
  days: DayPoint[];
  receipts: null | {
    coveredTo: string | null; // 이번 주 영수증 마지막 날 (없으면 null)
    net: number;
    discount: number;
    customers: number;
    hours: HourPoint[];
    heat: HeatCell[];
  };
  product: {
    coveredTo: string | null;
    total: number;
    supply: { type: string; amount: number }[];
    ranks: ProductRank[]; // 매출 순 전체 (화면에서 공급구분 필터 후 10개)
  };
}

// ── 메인 ─────────────────────────────────────────────────────────────

export async function loadSalesDashboard(period: Period, filter: StoreFilter, today = todayYmd()): Promise<DashboardData> {
  const stores = SALES_STORES.filter((s) => filter === 'all' || s.key === filter);
  const prev = shiftWeek(period, -1);
  const fetchTo = minYmd(period.end, today);

  const [perStore, receipts] = await Promise.all([
    Promise.all(
      stores.map(async (s) => {
        const [rows, since] = await Promise.all([
          fetchTo >= prev.start ? autoRows(s.table, prev.start, fetchTo) : Promise.resolve([] as AutoRow[]),
          earliestAutoDate(s.table),
        ]);
        return { store: s, rows, since };
      }),
    ),
    fetchTo >= prev.start ? receiptRows(stores.map((s) => s.key), prev.start, fetchTo) : Promise.resolve([] as ReceiptRow[]),
  ]);

  // 이번 주 기준일 = 선택 매장들의 이번 주 데이터 중 가장 늦은 날
  let cutoff: string | null = null;
  for (const { rows } of perStore)
    for (const r of rows) if (r.date >= period.start && r.date <= period.end && (!cutoff || r.date > cutoff)) cutoff = r.date;

  const inCur = (d: string) => cutoff !== null && d >= period.start && d <= cutoff;
  const inPrevSpan = (d: string) => cutoff !== null && d >= prev.start && d <= addDays(prev.start, daysBetween(period.start, cutoff));
  const inPrevWeek = (d: string) => d >= prev.start && d <= prev.end;

  // 영수증: 이번 주 / 전주
  const curRcpt = (receipts ?? []).filter((r) => r.sale_date >= period.start && r.sale_date <= period.end);
  const prevRcpt = (receipts ?? []).filter((r) => inPrevWeek(r.sale_date));
  const rcptByStore = new Map<string, ReceiptAgg>();
  const rcptByDay = new Map<string, ReceiptAgg>();
  const rcptByHour = new Map<number, ReceiptAgg>();
  const prevByHour = new Map<number, ReceiptAgg>();
  const heatMap = new Map<string, ReceiptAgg>();
  const rcptTotal = emptyAgg();
  let rcptCovered: string | null = null;
  for (const r of curRcpt) {
    const h = kstHour(r.sold_at);
    addReceipt(rcptTotal, r);
    bump(rcptByStore, r.store, r);
    bump(rcptByDay, r.sale_date, r);
    bump(rcptByHour, h, r);
    bump(heatMap, `${weekdayIdx(r.sale_date)}-${h}`, r);
    if (!rcptCovered || r.sale_date > rcptCovered) rcptCovered = r.sale_date;
  }
  for (const r of prevRcpt) bump(prevByHour, kstHour(r.sold_at), r);

  // 자동수집: 매장별·일별
  const dayMap = new Map<string, number>();
  const prevDayMap = new Map<string, number>(); // 키 = 이번 주 같은 요일 날짜
  const storeRows: StoreRow[] = perStore.map(({ store, rows, since }) => {
    let total = 0;
    let prevTotal = 0;
    for (const r of rows) {
      const t = rowTotal(r);
      if (inCur(r.date)) {
        total += t;
        dayMap.set(r.date, (dayMap.get(r.date) ?? 0) + t);
      } else if (inPrevWeek(r.date)) {
        const same = addDays(r.date, 7);
        prevDayMap.set(same, (prevDayMap.get(same) ?? 0) + t);
        if (inPrevSpan(r.date)) prevTotal += t;
      }
    }
    const comparable = cutoff !== null && since !== null && since <= prev.start;
    const c = rcptByStore.get(store.key);
    return {
      key: store.key,
      name: store.name,
      total,
      prevTotal,
      customers: receipts === null || !rcptCovered ? null : c?.customers ?? 0,
      since,
      comparable,
    };
  });

  const days: DayPoint[] = datesIn(period.start, period.end).map((date) => ({
    date,
    total: inCur(date) ? dayMap.get(date) ?? 0 : null,
    prevTotal: prevDayMap.has(date) ? prevDayMap.get(date)! : null,
    customers: rcptByDay.has(date) ? rcptByDay.get(date)!.customers : null,
  }));

  // 시간대 범위: 데이터 있는 시간 (없으면 10~21시)
  const seenHours = [...Array.from(rcptByHour.keys()), ...Array.from(prevByHour.keys())];
  const [h0, h1] = seenHours.length ? [Math.min(...seenHours), Math.max(...seenHours)] : DEFAULT_HOURS;
  const hourList = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
  const hasPrevRcpt = prevRcpt.length > 0;

  // 상품 데이터
  const locIds = await locationIds(stores.map((s) => s.name));
  const pos = locIds.length ? await posRows(locIds, period.start, fetchTo) : [];
  const byProduct = new Map<string, { qty: number; amount: number }>();
  let posCovered: string | null = null;
  for (const r of pos) {
    const a = byProduct.get(r.product_id) ?? { qty: 0, amount: 0 };
    a.qty += r.qty ?? 0;
    a.amount += r.amount ?? 0;
    byProduct.set(r.product_id, a);
    if (!posCovered || r.sale_date > posCovered) posCovered = r.sale_date;
  }
  const info = await productsByIds(Array.from(byProduct.keys()));
  const supplyMap = new Map<string, number>();
  const ranks: ProductRank[] = [];
  let posTotal = 0;
  for (const [id, a] of Array.from(byProduct.entries())) {
    const p = info.get(id);
    const supplyType = p?.supply_type || UNCLASSIFIED;
    supplyMap.set(supplyType, (supplyMap.get(supplyType) ?? 0) + a.amount);
    posTotal += a.amount;
    ranks.push({ sku: p?.sku ?? '', name: p?.name ?? '(상품 정보 없음)', supplyType, qty: a.qty, amount: a.amount });
  }
  const supplyRank = (t: string) => (SUPPLY_ORDER.includes(t) ? SUPPLY_ORDER.indexOf(t) : SUPPLY_ORDER.length);

  return {
    period,
    cutoff,
    total: storeRows.reduce((s, r) => s + r.total, 0),
    cmpTotal: storeRows.filter((r) => r.comparable).reduce((s, r) => s + r.total, 0),
    cmpPrevTotal: storeRows.filter((r) => r.comparable).reduce((s, r) => s + r.prevTotal, 0),
    stores: storeRows,
    days,
    receipts:
      receipts === null
        ? null
        : {
            coveredTo: rcptCovered,
            net: rcptTotal.net,
            discount: rcptTotal.discount,
            customers: rcptTotal.customers,
            hours: hourList.map((hour) => ({
              hour,
              net: rcptByHour.get(hour)?.net ?? 0,
              customers: rcptByHour.get(hour)?.customers ?? 0,
              prevNet: hasPrevRcpt ? prevByHour.get(hour)?.net ?? 0 : null,
            })),
            heat: Array.from({ length: 7 }, (_, weekday) =>
              hourList.map((hour) => {
                const a = heatMap.get(`${weekday}-${hour}`);
                return { weekday, hour, net: a?.net ?? 0, customers: a?.customers ?? 0 };
              }),
            ).flat(),
          },
    product: {
      coveredTo: posCovered,
      total: posTotal,
      supply: Array.from(supplyMap.entries())
        .map(([type, amount]) => ({ type, amount }))
        .filter((s) => s.amount !== 0)
        .sort((a, b) => supplyRank(a.type) - supplyRank(b.type) || b.amount - a.amount),
      ranks: ranks.sort((a, b) => b.amount - a.amount || b.qty - a.qty),
    },
  };
}

// 전주대비 달성률 (%). 비교 불가면 null
export function achievement(cur: number, prev: number): number | null {
  return prev ? (cur / prev) * 100 : null;
}
