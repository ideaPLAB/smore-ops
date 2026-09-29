'use client';

// 메인페이지(홈) — 로그인 직후 첫 화면 (2026-09-25 메인페이지 개편)
// 4분할: 공지사항(좌상) / 운영매뉴얼(우상) / 캘린더(좌하) / 매출 요약(우하)
// 조회는 전 역할, 작성은 본사·마스터만 (schema_patch_v0_36 RPC).
// 연결 순서: Phase 2(공지 ✅) → 3(매뉴얼 ✅) → 4(캘린더 ✅) → 5(매출 ✅)

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { isHqRole, type GoFn } from '@/lib/ledger/roles';
import { useRole } from '../role-context';
import { listNotices, fmtNoticeDate, isNewNotice, NoticeRow } from '@/lib/ledger/notices';
import { listRecentManuals, countManualsByCategory, MANUAL_CATEGORIES } from '@/lib/ledger/manuals';
import { listUpcomingEvents, fmtEventRange, dday, todayYmd, typeColor, CalendarEvent } from '@/lib/ledger/calendar';
import { EventTypeTag, useEventTypes } from './calendar-screen';
import { listStoreSummaries, changeRate, won, SALES_DASHBOARD_URL, StoreSummary } from '@/lib/ledger/sales-summary';
import { addDays, parseYmd } from '@/lib/ledger/calendar';

function HomeBlock({ icon, title, sub, action, children }: {
  icon: string; title: string; sub: string; action?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="lg-card hm-block">
      <div className="hm-block-h">
        <span className="hm-block-t">
          {icon} {title}
        </span>
        <span className="lg-sub">{sub}</span>
        {action && <span className="hm-block-act">{action}</span>}
      </div>
      <div className="hm-block-b">{children}</div>
    </section>
  );
}

const HOME_NOTICE_COUNT = 5;

function NoticeBlock({ go }: { go: GoFn }) {
  const [rows, setRows] = useState<NoticeRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    listNotices(HOME_NOTICE_COUNT)
      .then(setRows)
      .catch((e) => setErr((e as Error)?.message ?? String(e)));
  }, []);

  return (
    <HomeBlock
      icon="📢"
      title="공지사항"
      sub="최신 공지"
      action={
        <button type="button" className="hm-more" onClick={() => go('notices')}>
          더보기 ›
        </button>
      }
    >
      {err ? (
        <p className="hm-empty">공지를 불러오지 못했습니다. ({err})</p>
      ) : rows === null ? (
        <p className="hm-empty">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="hm-empty">등록된 공지가 없습니다.</p>
      ) : (
        <ul className="hm-list">
          {rows.map((n) => (
            <li key={n.id}>
              <button type="button" className="hm-li" onClick={() => go('notices', { noticeId: n.id })}>
                {n.pinned && <span className="nt-pin">고정</span>}
                <span className="hm-li-t">{n.title}</span>
                {isNewNotice(n.created_at) && <span className="nt-new">N</span>}
                <span className="hm-li-d">{fmtNoticeDate(n.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </HomeBlock>
  );
}

const HOME_MANUAL_COUNT = 4;

// 카테고리 6종 바로가기 + 최근 수정된 문서
function ManualBlock({ go }: { go: GoFn }) {
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [recent, setRecent] = useState<Awaited<ReturnType<typeof listRecentManuals>>>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([countManualsByCategory(), listRecentManuals(HOME_MANUAL_COUNT)])
      .then(([c, r]) => {
        setCounts(c);
        setRecent(r);
      })
      .catch((e) => setErr((e as Error)?.message ?? String(e)));
  }, []);

  return (
    <HomeBlock
      icon="📖"
      title="운영매뉴얼"
      sub="카테고리별 문서"
      action={
        <button type="button" className="hm-more" onClick={() => go('manuals')}>
          전체보기 ›
        </button>
      }
    >
      {err ? (
        <p className="hm-empty">매뉴얼을 불러오지 못했습니다. ({err})</p>
      ) : counts === null ? (
        <p className="hm-empty">불러오는 중…</p>
      ) : (
        <>
          <div className="hm-cats">
            {MANUAL_CATEGORIES.map((c) => (
              <button key={c} type="button" className="hm-cat" onClick={() => go('manuals', { category: c })}>
                <span>{c}</span>
                <span className="mn-cnt">{counts[c] ?? 0}</span>
              </button>
            ))}
          </div>
          {recent.length === 0 ? (
            <p className="hm-empty hm-empty-sm">등록된 매뉴얼이 없습니다.</p>
          ) : (
            <>
              <p className="hm-sublabel">최근 수정</p>
              <ul className="hm-list">
                {recent.map((m) => (
                  <li key={m.id}>
                    <button type="button" className="hm-li" onClick={() => go('manuals', { manualId: m.id, category: m.category })}>
                      <span className="mn-tag">{m.category}</span>
                      <span className="hm-li-t">{m.title}</span>
                      <span className="hm-li-d">{fmtNoticeDate(m.updated_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </HomeBlock>
  );
}

const HOME_EVENT_COUNT = 5;

// 오늘 진행 중이거나 다가오는 일정 — 클릭하면 캘린더에서 그 날짜가 열림
function CalendarBlock({ go }: { go: GoFn }) {
  const [rows, setRows] = useState<CalendarEvent[] | null>(null);
  const [err, setErr] = useState('');
  const today = todayYmd();
  const { types } = useEventTypes();

  useEffect(() => {
    listUpcomingEvents(today, HOME_EVENT_COUNT)
      .then(setRows)
      .catch((e) => setErr((e as Error)?.message ?? String(e)));
  }, [today]);

  return (
    <HomeBlock
      icon="📅"
      title="캘린더"
      sub="다가오는 일정"
      action={
        <button type="button" className="hm-more" onClick={() => go('calendar')}>
          전체보기 ›
        </button>
      }
    >
      {err ? (
        <p className="hm-empty">일정을 불러오지 못했습니다. ({err})</p>
      ) : rows === null ? (
        <p className="hm-empty">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="hm-empty">다가오는 일정이 없습니다.</p>
      ) : (
        <ul className="hm-list">
          {rows.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="hm-li"
                onClick={() => go('calendar', { eventDate: e.event_date < today ? today : e.event_date })}
              >
                <EventTypeTag type={e.event_type} color={typeColor(types, e.event_type)} />
                <span className="hm-li-t">{e.title}</span>
                <span className="hm-li-d">{fmtEventRange(e)}</span>
                <span className="cal-dday">{dday(e, today)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </HomeBlock>
  );
}

const SALES_REFRESH_MS = 10 * 60 * 1000; // 수집은 하루 1번(21시대)이라 10분이면 충분

function fmtSalesDate(date: string, today: string) {
  if (date === addDays(today, -1)) return '어제';
  if (date === today) return '오늘';
  const d = parseYmd(date);
  return `${d.getMonth() + 1}.${d.getDate()} 기준`;
}

// 매장별 최근 수집일 매출 + 전일 대비. 매장을 누르면 기기별 금액 펼침
// 본사·마스터 → /smore_report (메뉴바 없는 별도 페이지, 같은 탭 — 새 탭은 로그인 세션이 안 넘어감)
// 그 외 역할 → smore-delta 외부 대시보드
function SalesBlock() {
  const { role } = useRole();
  const [rows, setRows] = useState<StoreSummary[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const today = todayYmd();

  useEffect(() => {
    const load = () =>
      listStoreSummaries(today)
        .then((r) => {
          setRows(r);
          setErr('');
        })
        .catch((e) => setErr((e as Error)?.message ?? String(e)));
    load();
    const t = window.setInterval(load, SALES_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [today]);

  const dates = rows ? Array.from(new Set(rows.filter((r) => r.date).map((r) => r.date))) : [];
  const sameDay = rows !== null && dates.length === 1 && rows.every((r) => r.date);

  return (
    <HomeBlock
      icon="📊"
      title="매출 요약"
      sub="매장별 전일 매출"
      action={
        isHqRole(role) ? (
          <Link className="hm-more" href="/smore_report">
            대시보드 ›
          </Link>
        ) : (
          <a className="hm-more" href={SALES_DASHBOARD_URL} target="_blank" rel="noreferrer">
            대시보드 ›
          </a>
        )
      }
    >
      {err ? (
        <p className="hm-empty">매출을 불러오지 못했습니다. ({err})</p>
      ) : rows === null ? (
        <p className="hm-empty">불러오는 중…</p>
      ) : (
        <>
          <ul className="hm-list">
            {rows.map((r) => {
              const rate = changeRate(r);
              const isOpen = open === r.key;
              return (
                <li key={r.key}>
                  <button
                    type="button"
                    className="hm-li sl-row"
                    onClick={() => setOpen(isOpen ? null : r.key)}
                    aria-expanded={isOpen}
                    disabled={!r.date}
                  >
                    <span className="hm-li-t">{r.name}</span>
                    {r.date ? (
                      <>
                        <span className="hm-li-d">{fmtSalesDate(r.date, today)}</span>
                        <span className="sl-amt">{won(r.total)}</span>
                        <span className={`sl-rate${rate === null ? '' : rate >= 0 ? ' up' : ' down'}`}>
                          {rate === null ? '—' : `${rate >= 0 ? '▲' : '▼'} ${Math.abs(rate).toFixed(1)}%`}
                        </span>
                      </>
                    ) : (
                      <span className="hm-li-d">최근 2주 매출 없음</span>
                    )}
                  </button>
                  {isOpen && r.date && (
                    <div className="sl-sites">
                      {r.sites.map((x) => (
                        <span key={x.name} className="sl-site">
                          {x.name} <b>{won(x.amount)}</b>
                        </span>
                      ))}
                      {r.prevTotal !== null && <span className="sl-site sl-prev">전일 {won(r.prevTotal)}</span>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {sameDay && (
            <p className="sl-total">
              3개 매장 합계 <b>{won(rows.reduce((s, r) => s + r.total, 0))}</b>
            </p>
          )}
          <p className="sl-note">자동수집 매장 기준 · 매일 밤 수집 후 반영 · 전일 대비는 바로 전날과 비교</p>
        </>
      )}
    </HomeBlock>
  );
}

export function HomeScreen({ go }: { go: GoFn }) {
  return (
    <div className="hm-grid">
      <NoticeBlock go={go} />
      <ManualBlock go={go} />
      <CalendarBlock go={go} />
      <SalesBlock />
    </div>
  );
}
