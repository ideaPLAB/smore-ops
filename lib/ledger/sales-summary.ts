// 홈 매출 요약 (메인페이지 Phase 5) — 매출 자동수집 테이블을 같은 Supabase 에서 직접 조회.
// 대상: 자동수집 중인 3개 매장 (smore-delta 대시보드와 같은 데이터·같은 합계 기준).
// 합계 = 기기별 amount 합 + POS 행의 toss_amount (토스는 듀얼아이 POS와 별도 결제라 더함 — 대시보드 effectiveAmount 와 동일)
// 권한: 전 역할이 모든 매장 조회 (2026-09-18 나츠 확정)
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';
import { addDays, todayYmd } from './calendar';

export const SALES_DASHBOARD_URL = 'https://smore-delta.vercel.app';

export const SALES_STORES = [
  { key: 'samcheong', name: '삼청점', table: 'samcheong_sales', dashboard: `${SALES_DASHBOARD_URL}/` },
  { key: 'commons', name: '커먼즈행궁', table: 'commons_haenggung_sales', dashboard: `${SALES_DASHBOARD_URL}/commons-haenggung` },
  { key: 'toyhouse', name: '렉트성수(토이하우스)', table: 'lectoy_sales', dashboard: `${SALES_DASHBOARD_URL}/` },
] as const;

interface SalesRow {
  date: string;
  site_name: string;
  amount: number | null;
  toss_amount: number | null;
}

export interface StoreSummary {
  key: string;
  name: string;
  dashboard: string;
  date: string | null; // 가장 최근 수집일 (없으면 null)
  total: number;
  prevDate: string | null; // date 의 하루 전 (그날 데이터가 없으면 null)
  prevTotal: number | null;
  sites: { name: string; amount: number }[]; // 기기별 (토스는 'POS 토스'로 분리 표시)
}

const LOOKBACK_DAYS = 14;

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new SupabaseMissingError();
  return sb;
}

function dayRows(rows: SalesRow[], date: string) {
  return rows.filter((r) => r.date === date);
}

export function dayTotal(rows: SalesRow[]): number {
  return rows.reduce((s, r) => s + (r.amount ?? 0) + (r.toss_amount ?? 0), 0);
}

function siteBreakdown(rows: SalesRow[]) {
  const out: { name: string; amount: number }[] = [];
  for (const r of rows) {
    out.push({ name: r.site_name, amount: r.amount ?? 0 });
    if (r.toss_amount) out.push({ name: `${r.site_name} 토스`, amount: r.toss_amount });
  }
  return out;
}

async function storeSummary(store: (typeof SALES_STORES)[number], today: string): Promise<StoreSummary> {
  const { data, error } = await client()
    .from(store.table)
    .select('date,site_name,amount,toss_amount')
    .gte('date', addDays(today, -LOOKBACK_DAYS))
    .lte('date', today)
    .order('date', { ascending: false })
    .order('site_name', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as SalesRow[];
  const date = rows[0]?.date ?? null;
  const base = { key: store.key, name: store.name, dashboard: store.dashboard };
  if (!date) return { ...base, date: null, total: 0, prevDate: null, prevTotal: null, sites: [] };
  const cur = dayRows(rows, date);
  const prevDate = addDays(date, -1);
  const prev = dayRows(rows, prevDate);
  return {
    ...base,
    date,
    total: dayTotal(cur),
    prevDate: prev.length ? prevDate : null,
    prevTotal: prev.length ? dayTotal(prev) : null,
    sites: siteBreakdown(cur),
  };
}

export async function listStoreSummaries(today = todayYmd()): Promise<StoreSummary[]> {
  return Promise.all(SALES_STORES.map((s) => storeSummary(s, today)));
}

// 전일 대비 증감률 (%). 비교 불가면 null
export function changeRate(s: Pick<StoreSummary, 'total' | 'prevTotal'>): number | null {
  if (s.prevTotal === null || s.prevTotal === 0) return null;
  return ((s.total - s.prevTotal) / s.prevTotal) * 100;
}

export const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
