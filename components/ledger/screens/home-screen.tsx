'use client';

// 메인페이지(홈) — 로그인 직후 첫 화면 (2026-09-25 메인페이지 개편)
// 4분할: 공지사항(좌상) / 운영매뉴얼(우상) / 캘린더(좌하) / 매출 요약(우하)
// 조회는 전 역할, 작성은 본사·마스터만 (schema_patch_v0_36 RPC).
// 연결 순서: Phase 2(공지 ✅) → 3(매뉴얼 ✅) → 4(캘린더) → 5(매출)

import { ReactNode, useEffect, useState } from 'react';
import type { GoFn } from '@/lib/ledger/roles';
import { listNotices, fmtNoticeDate, isNewNotice, NoticeRow } from '@/lib/ledger/notices';
import { listRecentManuals, countManualsByCategory, MANUAL_CATEGORIES } from '@/lib/ledger/manuals';

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

function Soon({ text }: { text: string }) {
  return <p className="hm-empty">{text}</p>;
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

export function HomeScreen({ go }: { go: GoFn }) {
  return (
    <div className="hm-grid">
      <NoticeBlock go={go} />
      <ManualBlock go={go} />
      <HomeBlock icon="📅" title="캘린더" sub="입고·운영 일정">
        <Soon text="입고·운영 일정이 곧 이곳에 표시됩니다." />
      </HomeBlock>
      <HomeBlock icon="📊" title="매출 요약" sub="매장별 전일 매출">
        <Soon text="매장별 매출 요약이 곧 이곳에 표시됩니다." />
      </HomeBlock>
    </div>
  );
}
