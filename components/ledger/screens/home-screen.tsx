'use client';

// 메인페이지(홈) — 로그인 직후 첫 화면 (2026-09-25 메인페이지 개편 Phase 1)
// 4분할: 공지사항(좌상) / 운영매뉴얼(우상) / 캘린더(좌하) / 매출 요약(우하)
// 조회는 전 역할, 작성은 본사·마스터만 (schema_patch_v0_36 RPC).
// 각 블록 내용은 Phase 2(공지) → 3(매뉴얼) → 4(캘린더) → 5(매출) 순서로 연결.

import { ReactNode } from 'react';

function HomeBlock({ icon, title, sub, children }: { icon: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section className="lg-card hm-block">
      <div className="hm-block-h">
        <span className="hm-block-t">
          {icon} {title}
        </span>
        <span className="lg-sub">{sub}</span>
      </div>
      <div className="hm-block-b">{children}</div>
    </section>
  );
}

function Soon({ text }: { text: string }) {
  return <p className="hm-empty">{text}</p>;
}

export function HomeScreen() {
  return (
    <div className="hm-grid">
      <HomeBlock icon="📢" title="공지사항" sub="최신 공지">
        <Soon text="공지사항이 곧 이곳에 표시됩니다." />
      </HomeBlock>
      <HomeBlock icon="📖" title="운영매뉴얼" sub="카테고리별 문서">
        <Soon text="운영매뉴얼이 곧 이곳에 표시됩니다." />
      </HomeBlock>
      <HomeBlock icon="📅" title="캘린더" sub="입고·운영 일정">
        <Soon text="입고·운영 일정이 곧 이곳에 표시됩니다." />
      </HomeBlock>
      <HomeBlock icon="📊" title="매출 요약" sub="매장별 전일 매출">
        <Soon text="매장별 매출 요약이 곧 이곳에 표시됩니다." />
      </HomeBlock>
    </div>
  );
}
