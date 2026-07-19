'use client';

// WIKI — 본사 전용 문서 화면 (2026-07-19 나츠 지시)
// PRD·프로세스·사용법·업데이트 이력을 한 곳에 기록한다.
// 새 내용을 추가할 때는 해당 섹션의 updated 를 갱신하고 UPDATES 에 한 줄 남길 것.

import { useState, ReactNode } from 'react';

type WikiSection = {
  id: string;
  title: string;
  updated: string; // YYYY-MM-DD — 섹션 내용 마지막 수정일
  body: ReactNode;
};

/* ── 도식 빌딩블록 (사이트 디자인 토큰 사용) ── */

function FlowBox({ label, sub, accent }: { label: string; sub?: string; accent?: boolean }) {
  return (
    <div
      style={{
        border: accent ? '1.5px solid var(--lg-pine)' : '1px solid var(--lg-line)',
        background: accent ? '#fff7f3' : 'var(--lg-bg)',
        borderRadius: 12,
        padding: '10px 14px',
        textAlign: 'center',
        minWidth: 96,
        flex: '0 1 auto',
      }}
    >
      <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--lg-ink)' }}>{label}</div>
      {sub && <div style={{ fontSize: '.7rem', color: 'var(--lg-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Arrow({ label }: { label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto', padding: '0 2px' }}>
      {label && <span style={{ fontSize: '.66rem', color: 'var(--lg-muted)', marginBottom: 1 }}>{label}</span>}
      <span style={{ color: 'var(--lg-faint)', fontSize: '1rem', lineHeight: 1 }}>→</span>
    </div>
  );
}

function FlowRow({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '8px 0' }}>
      {children}
    </div>
  );
}

function StatusBadge({ s }: { s: '구현' | '부분' | '미구현' }) {
  const style =
    s === '구현'
      ? { background: 'var(--lg-ink)', color: '#fff' }
      : s === '부분'
        ? { background: '#fff7f3', color: 'var(--lg-pine)', border: '1px solid var(--lg-pine)' }
        : { background: 'var(--lg-rust-soft)', color: 'var(--lg-rust)', border: '1px solid var(--lg-rust)' };
  return (
    <span style={{ ...style, fontSize: '.68rem', fontWeight: 700, padding: '2px 10px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      {s === '구현' ? '✓ 구현됨' : s === '부분' ? '△ 부분 구현' : '✕ 미구현'}
    </span>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1.5px solid var(--lg-line)', color: 'var(--lg-muted)', fontWeight: 600, fontSize: '.74rem', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: '7px 10px', borderBottom: '1px solid var(--lg-line-soft)', verticalAlign: 'top', lineHeight: 1.55 }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: '.84rem', lineHeight: 1.7, color: 'var(--lg-ink)', margin: '8px 0' }}>{children}</p>;
}

function SubTitle({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: '.8rem', fontWeight: 700, margin: '16px 0 6px', color: 'var(--lg-ink)' }}>{children}</div>;
}

function Code({ children }: { children: ReactNode }) {
  return <code style={{ fontFamily: 'monospace', fontSize: '.76rem', background: 'var(--lg-surface)', padding: '1px 6px', borderRadius: 6 }}>{children}</code>;
}

/* ── 업데이트 로그 — 새 배포/변경 시 맨 위에 추가 ── */

const UPDATES: { date: string; text: string }[] = [
  { date: '2026-07-19', text: 'WIKI 메뉴 신설 (본사 전용). 창고 이름 본사창고→광주 변경, 재고현황 전 역할 전체 위치 열람, 발주판 RESET 버튼(입력수량 리셋), 발주 최종확인 모달 버튼 정리.' },
  { date: '2026-07-18', text: '프로세스 개편: 입고처리·출고대기열은 물류 전용, 업체발주는 매장 직납(매장 입고검수에 표시), 창고재고 유무로 창고분/업체분 자동 분기. 출고대기열 매장별 아코디언.' },
  { date: '2026-07-17', text: '가챠 취소(undo) 서버 롤백, 발주판 업체명·바코드 표시 및 검색 추가.' },
  { date: '2026-07-16', text: '엑셀 다운로드 전 화면 지원, 입고검수 수기입고, 자가사용 포스 업로드, 출고대기열·입고처리 엑셀 업로드, 발주 확정→전표 자동 생성(창고분/업체분 분리).' },
  { date: '2026-07-15', text: 'Smore Ops 최초 배포 (smore-ops.vercel.app).' },
];

/* ── 섹션 정의 ── */

const SECTIONS: WikiSection[] = [
  {
    id: 'overview',
    title: '이 앱은 무엇인가',
    updated: '2026-07-19',
    body: (
      <>
        <P>
          <b>Smore Ops(재고원장)</b>는 이카운트에 입력하기 <b>전에</b> 모든 재고 변동을 전표 단위로
          기록·검증하는 웹앱입니다. 이카운트를 대체하는 것이 아니라 <b>앞단의 선검증 원장</b>으로,
          현장에서 벌어지는 입고·출고·판매·조정을 먼저 여기에 기록하고, 검증된 데이터만 이카운트로 보냅니다.
        </P>
        <SubTitle>왜 만들었나</SubTitle>
        <P>
          위탁 정산 오류(수량 차이가 정산까지 흘러감), 마이너스 재고 추적 불가, 입력 실수가 ERP에
          그대로 반영되는 문제를 구조적으로 막기 위해 만들어졌습니다. 핵심 원칙은 <b>“선검증 후 입력”</b>.
        </P>
        <SubTitle>시스템 구성</SubTitle>
        <FlowRow>
          <FlowBox label="매장" sub="판매 · 검수 · 조정" />
          <FlowBox label="광주 물류" sub="입고 · 출고" />
          <FlowBox label="스모어몰" sub="온라인 출고" />
          <Arrow label="기록" />
          <FlowBox label="Smore Ops" sub="전표 · 실시간 재고 · 검증" accent />
          <Arrow label="검증 통과분만" />
          <FlowBox label="이카운트" sub="회계 · 위탁 정산" />
        </FlowRow>
        <P>
          역할 분담: Smore Ops = <b>현장의 진실</b> (실시간 수불), 이카운트 = <b>회계·정산의 공식 기록</b>입니다.
        </P>
      </>
    ),
  },
  {
    id: 'ledger',
    title: '재고가 움직이는 원리 (원장)',
    updated: '2026-07-19',
    body: (
      <>
        <P>
          모든 재고 변동은 <Code>inventory_events</Code>라는 <b>불변 원장</b>에 이벤트로만 쌓입니다.
          재고 수량을 직접 고치는 기능은 없습니다 — 항상 “무슨 일이 있었는지”를 기록하고, 현재고는 그
          이벤트들의 합으로 계산됩니다 (<Code>v_stock_balance</Code>). 그래서 어떤 재고든{' '}
          <b>언제·왜 변했는지 끝까지 추적</b>할 수 있습니다.
        </P>
        <SubTitle>이벤트 유형</SubTitle>
        <Table
          head={['이벤트', '뜻', '언제 생기나']}
          rows={[
            [<Code key="1">warehouse_in</Code>, '창고 입고', '입고처리 화면에서 검수 확정 시'],
            [<Code key="2">transfer_out</Code>, '창고 → 매장 출고', '물류가 출고대기열에서 출고 처리 시 (자동)'],
            [<Code key="3">store_receipt</Code>, '매장 입고 확정', '매장이 입고검수에서 수량 확인 시 (자동)'],
            [<Code key="4">transfer_cancel</Code>, '출고 취소 복원', '전표 취소 시 창고재고 자동 복원 (자동)'],
            [<Code key="5">sale</Code>, '판매 차감', 'POS 판매 데이터 업로드 시'],
            [<Code key="6">b2b_out</Code>, 'B2B·스모어몰 출고', '온라인 출고 업로드 시'],
            [<Code key="7">adjustment</Code>, '조정 (실사차이·파손·자가사용·가챠 등)', '자가사용/가챠 화면 등에서 사유와 함께'],
            ['반품', '고객·위탁 반품', <span key="8"><StatusBadge s="미구현" /> 설계 예정</span>],
          ]}
        />
        <SubTitle>마이너스 재고 방어</SubTitle>
        <P>
          창고에서 잔량보다 많은 수량을 출고요청하면 DB가 그 자리에서 차단합니다 (트리거).
          즉 마이너스 재고는 <b>발생 자체가 막혀 있습니다</b>. 관리자 예외 승인과 마이너스 대시보드는
          추후 구현 예정입니다.
        </P>
      </>
    ),
  },
  {
    id: 'order-flow',
    title: '주간 발주 흐름',
    updated: '2026-07-19',
    body: (
      <>
        <FlowRow>
          <FlowBox label="① 라운드 개설" sub="본사 · 마감일 설정" />
          <Arrow />
          <FlowBox label="② 수량 입력" sub="매장 · 발주판" />
          <Arrow />
          <FlowBox label="③ 최종 확인 · 확정" sub="본사 · 전표 자동 생성" accent />
        </FlowRow>
        <P>
          확정 순간 시스템이 품목별로 <b>광주 창고재고가 있으면 창고분, 없으면 업체분</b>으로 자동으로 나눕니다.
        </P>
        <FlowRow>
          <FlowBox label="창고분" sub="출고요청 전표" accent />
          <Arrow label="물류" />
          <FlowBox label="출고 대기열" sub="광주 · 출고 처리" />
          <Arrow label="매장" />
          <FlowBox label="입고검수" sub="실수량 확인" />
        </FlowRow>
        <FlowRow>
          <FlowBox label="업체분" sub="구매발주 전표" accent />
          <Arrow label="업체가 매장으로 직납" />
          <FlowBox label="입고검수" sub="매장 · 직납 수령 확인" />
          <Arrow />
          <FlowBox label="이카운트 파일" sub="다운로드 · 업로드" />
        </FlowRow>
        <SubTitle>운영 규칙</SubTitle>
        <P>
          · 판매 데이터가 7일 이상 오래되면 확정이 차단됩니다 — 먼저 판매 데이터를 업로드하세요.<br />
          · 확정 취소(전표 회수)를 하면 입력했던 수량은 <b>복원</b>됩니다. 입력을 비우려면
          발주판의 <b>RESET</b> 버튼을 사용하세요.<br />
          · 제안수량 공식: 주판매 × (배송기간＋1주) ＋ 안전재고 − (매장재고＋이동중), 발주단위로 올림합니다.
        </P>
      </>
    ),
  },
  {
    id: 'screens',
    title: '화면 · 역할 안내',
    updated: '2026-07-19',
    body: (
      <>
        <Table
          head={['화면', '누가', '무엇을']}
          rows={[
            ['발주판', '본사 · 매장', '매장별 발주 수량 입력, 본사가 확정해 전표 생성'],
            ['재고 현황', '모든 역할', '광주·매장 전체 위치의 실시간 재고와 이동중 수량 (2026-07-19부터 전 역할 전체 열람)'],
            ['입고검수', '매장', '창고 출고분·업체 직납분 실수량 확인'],
            ['가챠머신 관리 / 자가사용', '매장', '가챠 실사·리필, 판매 외 사용 차감 (사유 필수)'],
            ['이동중 현황', '본사', '발주·출고·검수 3-way 대사 (어디서 수량이 어긋났는지)'],
            ['출고요청', '본사', '발주판 외 수동 창고→매장 이동 (팝업 초도 물량 등)'],
            ['출고 대기열 / 입고 처리', '물류(광주)', '출고 포장·확정, 업체→창고 입고 검수'],
            ['판매 데이터 업로드', '본사', 'POS 판매 반영 → 발주 제안수량 재계산'],
            ['상품관리 / 계정 관리', '본사', '품목 마스터·매장 취급상품, 사용자 권한'],
            ['WIKI', '본사', '이 문서 — PRD·사용법·업데이트 기록'],
          ]}
        />
        <P>
          권한: <b>본사(hq)·마스터(admin)</b>는 전 화면, <b>매장 매니저</b>는 발주판·재고·검수·가챠·자가사용,
          <b> 물류</b>는 대기열·입고처리·재고. 물류 계정의 위치는 <b>광주</b>로 등록합니다.
        </P>
      </>
    ),
  },
  {
    id: 'data',
    title: '데이터 구조 요약',
    updated: '2026-07-19',
    body: (
      <>
        <P>Supabase(PostgreSQL) 기반. 자세한 스키마는 PRD v0.2와 <Code>smore-ledger/</Code> SQL 패치 참조.</P>
        <Table
          head={['구분', '테이블', '역할']}
          rows={[
            ['마스터', <span key="a"><Code>products</Code> · <Code>vendors</Code> · <Code>locations</Code></span>, '품목(위탁 여부는 vendor_id 유무) · 업체 · 위치(광주/매장/거래처)'],
            ['원장', <span key="b"><Code>inventory_events</Code> → <Code>v_stock_balance</Code></span>, '불변 이벤트 원장 → 합산 현재고 뷰'],
            ['이동 전표', <span key="c"><Code>transfer_orders</Code> + <Code>lines</Code></span>, '창고↔매장 이동 헤더+라인. 라인 저장 시 원장 이벤트 자동 생성'],
            ['발주', <span key="d"><Code>order_rounds</Code> · <Code>order_inputs</Code> · <Code>order_confirmations</Code></span>, '주간 라운드 · 매장 입력 · 확정 이력(전표 ID 기록)'],
            ['운영', <span key="e"><Code>gacha_*</Code> · <Code>self_use_entries</Code> · <Code>pos_sales_daily</Code></span>, '가챠 · 자가사용 · POS 일별 판매'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'status',
    title: '기능 구현 현황',
    updated: '2026-07-19',
    body: (
      <>
        <Table
          head={['기능', '상태', '메모']}
          rows={[
            ['F1 품목 마스터', <StatusBadge key="1" s="구현" />, '엑셀 등록/수정, 매장별 취급상품'],
            ['F2 수불 전표', <StatusBadge key="2" s="구현" />, '반품 이벤트만 미구현 (설계 예정)'],
            ['F3 실시간 재고 조회', <StatusBadge key="3" s="구현" />, '위치별 현재고 + 이동중'],
            ['F4 마이너스 재고 감지', <StatusBadge key="4" s="부분" />, 'DB 차단은 됨 · 예외승인 UI/대시보드 예정'],
            ['F5 이카운트 내보내기', <StatusBadge key="5" s="부분" />, '발주 확정 엑셀 다운로드 됨 · 검증 배치 UI 예정'],
            ['F6 재고 실사', <StatusBadge key="6" s="미구현" />, ''],
            ['F7 위탁 정산 검증 리포트', <StatusBadge key="7" s="미구현" />, ''],
            ['F8 알림', <StatusBadge key="8" s="미구현" />, ''],
            ['F9 감사 로그', <StatusBadge key="9" s="부분" />, '원장 자체가 불변 기록 · 전용 로그 예정'],
            ['F10 대시보드·리포트', <StatusBadge key="10" s="부분" />, '발주판 구현됨 · 위클리 리포트 예정'],
          ]}
        />
      </>
    ),
  },
  {
    id: 'updates',
    title: '업데이트 기록',
    updated: UPDATES[0].date,
    body: (
      <>
        {UPDATES.map((u) => (
          <div key={u.date + u.text.slice(0, 8)} style={{ display: 'flex', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--lg-line-soft)', fontSize: '.82rem', lineHeight: 1.6 }}>
            <span style={{ fontFamily: 'monospace', fontSize: '.74rem', color: 'var(--lg-muted)', flex: '0 0 84px', paddingTop: 2 }}>{u.date}</span>
            <span style={{ flex: 1 }}>{u.text}</span>
          </div>
        ))}
      </>
    ),
  },
];

const LAST_UPDATED = SECTIONS.reduce((m, s) => (s.updated > m ? s.updated : m), '');

/* ── 화면 ── */

export function WikiScreen() {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const section = SECTIONS.find((s) => s.id === active) ?? SECTIONS[0];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>WIKI</h1>
        <span className="lg-badge">마지막 업데이트 {LAST_UPDATED}</span>
      </div>
      <p style={{ margin: '4px 0 14px', color: 'var(--lg-muted)', fontSize: '.8rem' }}>
        Smore Ops가 어떻게 돌아가는지, 무엇이 바뀌었는지 기록하는 곳입니다. (본사 전용)
      </p>

      <div className="lg-chip-toggle" style={{ display: 'inline-flex', flexWrap: 'wrap', marginBottom: 14 }}>
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={s.id === active ? 'on' : ''} onClick={() => setActive(s.id)}>
            {s.title}
          </button>
        ))}
      </div>

      <div className="lg-card" style={{ padding: '18px 22px', maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>{section.title}</h2>
          <span className="lg-badge">업데이트 {section.updated}</span>
        </div>
        {section.body}
      </div>
    </div>
  );
}
