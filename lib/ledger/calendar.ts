// 캘린더 일정 조회·작성 (schema_patch_v0_36 calendar_events, 메인페이지 Phase 4).
// 조회는 테이블 직접 SELECT, 쓰기는 RPC 경유 — RPC 안에서 본사·마스터만 허용.
// 날짜는 'YYYY-MM-DD' 문자열(DB date)로 다룬다 — 시간대 변환 없이 달력 칸과 1:1.
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';

// DB check 제약과 같은 순서·표기
export const EVENT_TYPES = ['입고', '팝업', '정산마감', '기타'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export interface CalendarEvent {
  id: string;
  title: string;
  event_date: string; // YYYY-MM-DD
  end_date: string | null; // 하루짜리면 null
  event_type: EventType;
  location_id: string | null; // null = 전체 매장
  memo: string;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = 'id,title,event_date,end_date,event_type,location_id,memo,author_name,created_at,updated_at';

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new SupabaseMissingError();
  return sb;
}

export const lastDay = (e: Pick<CalendarEvent, 'event_date' | 'end_date'>) => e.end_date ?? e.event_date;

function byDate(a: CalendarEvent, b: CalendarEvent) {
  return a.event_date.localeCompare(b.event_date) || lastDay(a).localeCompare(lastDay(b)) || a.title.localeCompare(b.title);
}

// from~to(포함) 기간과 겹치는 일정 — 여러 날짜 일정은 기간에 하루라도 걸치면 포함
export async function listEvents(from: string, to: string): Promise<CalendarEvent[]> {
  const { data, error } = await client()
    .from('calendar_events')
    .select(COLS)
    .lte('event_date', to)
    .or(`end_date.gte.${from},and(end_date.is.null,event_date.gte.${from})`)
    .order('event_date', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as CalendarEvent[]).sort(byDate);
}

// 홈 칸용 — 오늘 진행 중이거나 앞으로 있을 일정, 가까운 순
export async function listUpcomingEvents(today: string, limit: number): Promise<CalendarEvent[]> {
  const { data, error } = await client()
    .from('calendar_events')
    .select(COLS)
    .or(`end_date.gte.${today},and(end_date.is.null,event_date.gte.${today})`)
    .order('event_date', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as CalendarEvent[]).sort(byDate);
}

export async function saveEvent(
  actorId: string,
  input: {
    id: string | null;
    title: string;
    eventDate: string;
    endDate: string | null;
    eventType: EventType;
    locationId: string | null;
    memo: string;
  },
): Promise<string> {
  const { data, error } = await client().rpc('app_save_event', {
    p_actor: actorId,
    p_id: input.id,
    p_title: input.title,
    p_event_date: input.eventDate,
    p_end_date: input.endDate,
    p_event_type: input.eventType,
    p_location_id: input.locationId,
    p_memo: input.memo,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteEvent(actorId: string, id: string): Promise<void> {
  const { error } = await client().rpc('app_delete_event', { p_actor: actorId, p_id: id });
  if (error) throw error;
}

// ── 날짜 도우미 (브라우저 로컬 날짜 기준) ────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayYmd(): string {
  return ymd(new Date());
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

// 월 달력 칸: 일요일 시작, 앞뒤 달 날짜 포함 6주(42칸)
export function monthCells(year: number, month0: number): string[] {
  const first = new Date(year, month0, 1);
  const start = new Date(year, month0, 1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => ymd(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

export function eventCovers(e: CalendarEvent, day: string): boolean {
  return e.event_date <= day && day <= lastDay(e);
}

const WD = ['일', '월', '화', '수', '목', '금', '토'];

// 9.18(목) / 9.18(목) ~ 9.20(토)
export function fmtEventRange(e: Pick<CalendarEvent, 'event_date' | 'end_date'>): string {
  const one = (s: string) => {
    const d = parseYmd(s);
    return `${d.getMonth() + 1}.${d.getDate()}(${WD[d.getDay()]})`;
  };
  return e.end_date && e.end_date !== e.event_date ? `${one(e.event_date)} ~ ${one(e.end_date)}` : one(e.event_date);
}

// 오늘 기준 D-day 표시: 진행 중이면 '진행 중', 오늘이면 'D-DAY'
export function dday(e: CalendarEvent, today: string): string {
  if (e.event_date === today) return 'D-DAY';
  if (eventCovers(e, today)) return '진행 중';
  const diff = Math.round((parseYmd(e.event_date).getTime() - parseYmd(today).getTime()) / 86400000);
  return `D-${diff}`;
}
