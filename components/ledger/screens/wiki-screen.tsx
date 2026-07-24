'use client';

// WIKI — 본사 전용 문서 화면 (2026-07-19 나츠 지시)
// 대상 독자: 비개발자·완전 초보·일반 직원·경영진. 전문용어 최소화, 존댓말 유지.
// 새 내용을 추가할 때는 해당 섹션의 updated 를 갱신하고 UPDATES 에 한 줄 남길 것.

import { useState, ReactNode } from 'react';

type WikiSection = {
  id: string;
  title: string;
  updated: string; // YYYY-MM-DD — 섹션 내용 마지막 수정일
  body: ReactNode;
};

/* ── 애니메이션 플로우 빌딩블록 (globals.css .wk-*) ── */

type StepDef = { label: string; sub?: string; who?: string; accent?: boolean };

function FlowSteps({ steps, connLabels }: { steps: StepDef[]; connLabels?: (string | undefined)[] }) {
  const out: ReactNode[] = [];
  steps.forEach((s, i) => {
    if (i > 0) {
      out.push(
        <div key={`c${i}`} className="wk-conn" style={{ animationDelay: `${i * 0.18}s` }}>
          {connLabels?.[i - 1] && <span className="wk-conn-label">{connLabels[i - 1]}</span>}
        </div>,
      );
    }
    out.push(
      <div
        key={`s${i}`}
        className="wk-step"
        style={{
          animationDelay: `${i * 0.18}s`,
          border: s.accent ? '2px solid var(--lg-pine)' : '1.5px solid var(--lg-line)',
          background: s.accent ? '#fff7f3' : 'var(--lg-bg)',
          borderRadius: 14,
          padding: '14px 18px',
          textAlign: 'center',
          minWidth: 118,
          flex: '0 1 auto',
          boxShadow: '0 1px 4px rgba(0,0,0,.04)',
        }}
      >
        {s.who && (
          <div style={{ fontSize: '.72rem', fontWeight: 700, color: s.accent ? 'var(--lg-pine)' : 'var(--lg-muted)', marginBottom: 3 }}>
            {s.who}
          </div>
        )}
        <div style={{ fontSize: '.95rem', fontWeight: 700, color: 'var(--lg-ink)', lineHeight: 1.4 }}>{s.label}</div>
        {s.sub && <div style={{ fontSize: '.78rem', color: 'var(--lg-muted)', marginTop: 3, lineHeight: 1.5 }}>{s.sub}</div>}
      </div>,
    );
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '14px 0 6px' }}>
      {out}
    </div>
  );
}

function BranchLabel({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'inline-block', background: 'var(--lg-ink)', color: '#fff', fontSize: '.8rem', fontWeight: 700, padding: '5px 14px', borderRadius: 999, margin: '14px 0 2px' }}>
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
    <span style={{ ...style, fontSize: '.78rem', fontWeight: 700, padding: '3px 12px', borderRadius: 999, whiteSpace: 'nowrap' }}>
      {s === '구현' ? '✓ 사용 가능' : s === '부분' ? '△ 일부 구현' : '준비 중'}
    </span>
  );
}

function Table({ head, rows, widths }: { head: string[]; rows: (string | ReactNode)[][]; widths?: (string | undefined)[] }) {
  return (
    <div style={{ overflowX: 'auto', margin: '10px 0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.9rem' }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} style={{ width: widths?.[i], textAlign: 'left', padding: '10px 12px', background: 'var(--lg-surface)', borderBottom: '1.5px solid var(--lg-line)', color: 'var(--lg-ink)', fontWeight: 700, fontSize: '.82rem', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ background: i % 2 ? 'var(--lg-bg)' : '#fcfcfc' }}>
              {r.map((c, j) => (
                <td key={j} style={{ padding: '10px 12px', borderBottom: '1px solid var(--lg-line-soft)', verticalAlign: 'top', lineHeight: 1.7 }}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: '.95rem', lineHeight: 1.85, color: 'var(--lg-ink)', margin: '10px 0' }}>{children}</p>;
}

function SubTitle({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '22px 0 8px' }}>
      <span style={{ width: 4, height: 16, background: 'var(--lg-pine)', borderRadius: 2 }} />
      <span style={{ fontSize: '.98rem', fontWeight: 700, color: 'var(--lg-ink)' }}>{children}</span>
    </div>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return <div className="wk-callout">{children}</div>;
}

function Small({ children }: { children: ReactNode }) {
  return <span style={{ fontSize: '.78rem', color: 'var(--lg-faint)', fontFamily: 'monospace' }}>{children}</span>;
}

/* ── 업데이트 로그 — 새 배포/변경 시 맨 위에 추가 ── */

const UPDATES: { date: string; text: string }[] = [
  { date: '2026-07-24', text: '가챠 화면 개편: 점검 모달 제거, 슬롯별 보충 인라인 입력으로 변경, 품목변경 이력 카드 하단 표시, 상품명+SKU 2줄 표시, 총 보충수량 오렌지색으로 통일. 입고처리/입고검수 역할 분리: 입고처리는 광주 물류 입고 전표 전용(업체·매장·본사→광주), 입고검수는 각 매장으로 향하는 전표 전용(창고분·업체직납 모두 포함).' },
  { date: '2026-07-23', text: '가챠머신 관리 개선: 머신 등록 오류 해결, 품목변경 검색 기능 추가 (상품명·바코드·상품코드로 검색 가능), 취소/등록 버튼 크기 통일, 상품명 말줄임표 처리.' },
  { date: '2026-07-19', text: 'WIKI 메뉴 신설 (본사 전용). 창고 이름을 광주로 변경, 재고현황을 모든 역할이 전체 열람 가능하게 변경, 발주판 RESET 버튼 추가, 발주 최종확인 화면 버튼 정리.' },
  { date: '2026-07-18', text: '프로세스 개편: 출고대기열·입고처리는 광주(물류) 전용으로 정리. 업체 발주분은 매장으로 직접 배송되어 매장 입고검수에 표시. 창고 재고 유무로 창고분/업체분 자동 구분.' },
  { date: '2026-07-17', text: '가챠 점검 실수 시 되돌리기 기능, 발주판에 업체명·바코드 표시와 검색 추가.' },
  { date: '2026-07-16', text: '모든 화면 엑셀 다운로드 지원, 입고검수 수기입고, 자가사용 포스 업로드, 발주 확정 시 전표 자동 생성(창고분/업체분 분리).' },
  { date: '2026-07-15', text: 'Smore Ops 최초 오픈 (smore-ops.vercel.app).' },
];

/* ── 섹션 정의 ── */

const SECTIONS: WikiSection[] = [
  {
    id: 'overview',
    title: '이 앱은 무엇인가요',
    updated: '2026-07-19',
    body: (
      <>
        <Callout>
          <b>Smore Ops는 이카운트에 올리기 전, 모든 재고의 움직임을 먼저 기록하고 검증하는 &lsquo;중간 검문소&rsquo;입니다.</b>
        </Callout>
        <P>
          지금까지는 재고 숫자를 이카운트에 바로 입력했기 때문에, 입력 실수가 그대로 회계와 위탁
          정산까지 흘러갔습니다. 마이너스 재고가 왜 생겼는지 추적하기도 어려웠습니다.
        </P>
        <P>
          그래서 순서를 바꿨습니다. 현장에서 생기는 모든 재고 변화(입고·출고·판매·조정)를{' '}
          <b>먼저 이 앱에 기록</b>하고, 검증을 통과한 데이터만 이카운트로 보냅니다.
        </P>
        <SubTitle>전체 그림</SubTitle>
        <FlowSteps
          steps={[
            { label: '현장', sub: '매장 · 광주 물류 · 스모어몰', who: '재고가 움직이는 곳' },
            { label: 'Smore Ops', sub: '전표 기록 · 실시간 재고 · 오류 차단', who: '이 앱 (중간 검문소)', accent: true },
            { label: '이카운트', sub: '회계 · 위탁 정산', who: '공식 장부' },
          ]}
          connLabels={['모든 변동 기록', '검증 통과분만']}
        />
        <SubTitle>역할 분담</SubTitle>
        <P>
          Smore Ops는 <b>&ldquo;현장에서 지금 무슨 일이 벌어지고 있는가&rdquo;</b>를 보여주는 실시간 장부이고,
          이카운트는 <b>회계와 정산의 공식 기록</b>입니다. 서로 대체하지 않고 역할을 나눕니다.
        </P>
      </>
    ),
  },
  {
    id: 'ledger',
    title: '재고는 어떻게 기록되나요',
    updated: '2026-07-19',
    body: (
      <>
        <Callout>
          <b>재고 숫자를 직접 고치는 기능은 없습니다.</b> 모든 변화는 가계부처럼 &ldquo;언제, 어디서,
          무슨 일이 있었는지&rdquo; 한 줄씩 기록되고, 현재 재고는 그 기록의 합으로 계산됩니다.
        </Callout>
        <P>
          그래서 어떤 재고든 <b>왜 이 숫자가 됐는지 끝까지 거슬러 올라갈 수 있습니다.</b> 숫자가
          안 맞을 때 &ldquo;누가 언제 뭘 했는지&rdquo;를 찾을 수 있다는 뜻입니다.
        </P>
        <SubTitle>기록되는 상황들</SubTitle>
        <Table
          head={['이런 일이 생기면', '이렇게 기록됩니다']}
          widths={['42%']}
          rows={[
            ['업체에서 광주 창고에 물건이 도착', <span key="1">창고 입고 <Small>warehouse_in</Small></span>],
            ['광주에서 매장으로 물건을 보냄', <span key="2">창고 출고 <Small>transfer_out</Small></span>],
            ['매장이 도착한 물건을 확인함', <span key="3">매장 입고 확정 <Small>store_receipt</Small></span>],
            ['보내기로 한 전표를 취소함', <span key="4">창고 재고 자동 복원 <Small>transfer_cancel</Small></span>],
            ['매장에서 상품이 판매됨', <span key="5">판매 차감 <Small>sale</Small></span>],
            ['스모어몰·B2B로 출고됨', <span key="6">온라인 출고 <Small>b2b_out</Small></span>],
            ['파손·증정·자가사용·가챠 점검 등', <span key="7">조정 — 반드시 사유와 함께 <Small>adjustment</Small></span>],
            ['고객 반품 · 위탁 반품', <span key="8"><StatusBadge s="미구현" /> 처리 방식 설계 예정</span>],
          ]}
        />
        <SubTitle>마이너스 재고는 이렇게 막습니다</SubTitle>
        <P>
          창고에 남은 수량보다 많이 출고하려고 하면 시스템이 <b>그 자리에서 차단</b>합니다. 즉
          마이너스 재고는 애초에 만들어질 수 없습니다. (예외적으로 허용해야 하는 경우를 위한
          관리자 승인 기능은 준비 중입니다.)
        </P>
      </>
    ),
  },
  {
    id: 'order-flow',
    title: '매주 발주는 이렇게 흘러갑니다',
    updated: '2026-07-19',
    body: (
      <>
        <SubTitle>1단계 — 발주 수량 정하기</SubTitle>
        <FlowSteps
          steps={[
            { label: '라운드 열기', sub: '마감일 설정', who: '① 본사' },
            { label: '수량 입력', sub: '발주판에서 매장별로', who: '② 매장' },
            { label: '확인 후 확정', sub: '전표 자동 생성', who: '③ 본사', accent: true },
          ]}
        />
        <P>
          발주판은 매장마다 <b>제안수량</b>(최근 판매량과 재고를 계산한 추천값)을 보여주고, 매장은
          그 값을 참고해 최종수량을 입력합니다.
        </P>
        <Callout>
          확정 버튼을 누르는 순간, 시스템이 품목마다 <b>광주 창고에 재고가 있으면 &lsquo;창고분&rsquo;,
          없으면 &lsquo;업체분&rsquo;</b>으로 자동으로 나눠서 전표를 만듭니다. 담당자가 직접 나눌 필요가
          없습니다.
        </Callout>
        <BranchLabel>창고분 — 광주에 재고가 있는 상품</BranchLabel>
        <FlowSteps
          steps={[
            { label: '출고요청 전표', sub: '자동 생성', accent: true },
            { label: '포장 · 출고', sub: '출고 대기열에서 처리', who: '광주 물류' },
            { label: '도착 · 검수', sub: '입고검수에서 수량 확인', who: '매장' },
            { label: '완료', sub: '재고 자동 반영' },
          ]}
          connLabels={[undefined, '배송', undefined]}
        />
        <BranchLabel>업체분 — 광주에 재고가 없는 상품</BranchLabel>
        <FlowSteps
          steps={[
            { label: '구매발주 전표', sub: '자동 생성', accent: true },
            { label: '업체가 매장으로 직접 배송', sub: '광주를 거치지 않음' },
            { label: '도착 · 검수', sub: '입고검수에 “업체 직납” 표시', who: '매장' },
            { label: '이카운트 파일', sub: '다운로드해 업로드', who: '본사' },
          ]}
        />
        <SubTitle>알아두면 좋은 규칙</SubTitle>
        <P>
          · 판매 데이터가 7일 이상 오래되면 확정 버튼이 잠깁니다 — 먼저 판매 데이터를 업로드하세요.<br />
          · 확정을 취소(전표 회수)하면 입력했던 수량은 그대로 <b>복원</b>됩니다. 처음부터 다시
          입력하고 싶다면 발주판의 <b>RESET</b> 버튼으로 비울 수 있습니다.
        </P>
      </>
    ),
  },
  {
    id: 'screens',
    title: '누가 어떤 화면을 쓰나요',
    updated: '2026-07-24',
    body: (
      <>
        <SubTitle>본사 (전체 화면 사용)</SubTitle>
        <Table
          head={['화면', '하는 일']}
          widths={['32%']}
          rows={[
            ['발주판', '라운드 열기, 매장 입력 확인, 발주 확정'],
            ['이동중 현황', '발주 수량 · 실제 출고 수량 · 매장 확인 수량을 나란히 비교 — 어디서 차이가 났는지 바로 보임'],
            ['출고요청', '발주와 별개로 창고→매장 이동이 필요할 때 (팝업 초도 물량 등)'],
            ['판매 데이터 업로드', 'POS 판매 파일 업로드 → 재고 차감 + 발주 추천값 갱신'],
            ['상품관리 · 계정 관리', '상품 정보와 사용자 권한 관리'],
            ['WIKI', '지금 보고 있는 이 문서'],
          ]}
        />
        <SubTitle>매장</SubTitle>
        <Table
          head={['화면', '하는 일']}
          widths={['32%']}
          rows={[
            ['발주판', '매주 발주 수량 입력'],
            ['입고검수', '도착한 물건(창고분·업체 직납분) 수량 확인'],
            ['가챠머신 관리 · 자가사용 처리', '가챠 보충 수량 기록 및 품목변경, 슬롯별 변경 이력 조회, 판매 외 사용 기록 (사유 필수)'],
            ['재고 현황', '전체 위치의 재고 조회'],
          ]}
        />
        <SubTitle>광주 (물류)</SubTitle>
        <Table
          head={['화면', '하는 일']}
          widths={['32%']}
          rows={[
            ['출고 대기열', '매장으로 보낼 물건 포장 · 출고 처리'],
            ['입고 처리', '광주 창고로 들어오는 모든 전표 검수 (업체·매장·본사 → 광주)'],
            ['재고 현황', '전체 위치의 재고 조회'],
          ]}
        />
        <P>
          재고 현황은 2026-07-19부터 <b>모든 역할이 전체 위치(광주+매장)를 볼 수 있습니다.</b>
        </P>
      </>
    ),
  },
  {
    id: 'status',
    title: '기능 현황',
    updated: '2026-07-19',
    body: (
      <>
        <P>이 앱이 지금 할 수 있는 것과 준비 중인 것입니다.</P>
        <Table
          head={['기능', '상태', '설명']}
          widths={['30%', '16%']}
          rows={[
            ['상품 관리', <StatusBadge key="1" s="구현" />, '상품 등록·수정, 엑셀 일괄 처리, 매장별 취급상품'],
            ['재고 기록 (전표)', <StatusBadge key="2" s="구현" />, '모든 재고 변화 기록 — 반품만 설계 예정'],
            ['실시간 재고 조회', <StatusBadge key="3" s="구현" />, '위치별 현재고와 이동중 수량'],
            ['마이너스 재고 차단', <StatusBadge key="4" s="부분" />, '차단은 작동 중 · 예외 승인과 현황판은 준비 중'],
            ['이카운트 연계', <StatusBadge key="5" s="부분" />, '발주 확정 엑셀 다운로드 가능 · 자동 검증은 준비 중'],
            ['재고 실사', <StatusBadge key="6" s="미구현" />, '주기적 실사 기능'],
            ['위탁 정산 검증 리포트', <StatusBadge key="7" s="미구현" />, '업체별 재고·정산 대조'],
            ['알림', <StatusBadge key="8" s="미구현" />, '이상 상황 자동 알림'],
            ['대시보드·리포트', <StatusBadge key="9" s="부분" />, '발주판 완료 · 위클리 리포트는 준비 중'],
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
        <P>앱이 바뀔 때마다 여기에 기록합니다.</P>
        <div style={{ marginTop: 6 }}>
          {UPDATES.map((u, i) => (
            <div key={u.date + i} style={{ display: 'flex', gap: 16, position: 'relative', paddingBottom: i === UPDATES.length - 1 ? 0 : 18 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '0 0 auto' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: i === 0 ? 'var(--lg-pine)' : 'var(--lg-faint)', marginTop: 6 }} />
                {i !== UPDATES.length - 1 && <span style={{ width: 2, flex: 1, background: 'var(--lg-line)', marginTop: 4 }} />}
              </div>
              <div style={{ paddingBottom: 4 }}>
                <div style={{ fontWeight: 700, fontSize: '.88rem', color: i === 0 ? 'var(--lg-pine)' : 'var(--lg-ink)' }}>{u.date}{i === 0 && ' · 최신'}</div>
                <div style={{ fontSize: '.92rem', lineHeight: 1.75, marginTop: 2 }}>{u.text}</div>
              </div>
            </div>
          ))}
        </div>
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
        <span className="lg-badge" style={{ fontSize: '.8rem' }}>마지막 업데이트 {LAST_UPDATED}</span>
      </div>
      <p style={{ margin: '4px 0 16px', color: 'var(--lg-muted)', fontSize: '.9rem' }}>
        Smore Ops가 어떻게 돌아가는지, 무엇이 바뀌었는지 기록하는 공간입니다. (본사 전용)
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setActive(s.id)}
            style={{
              padding: '9px 18px',
              fontSize: '.88rem',
              fontWeight: s.id === active ? 700 : 500,
              border: s.id === active ? 'none' : '1px solid var(--lg-line)',
              borderRadius: 999,
              background: s.id === active ? 'var(--lg-pine)' : 'var(--lg-bg)',
              color: s.id === active ? '#fff' : 'var(--lg-ink)',
              cursor: 'pointer',
            }}
          >
            {s.title}
          </button>
        ))}
      </div>

      <div key={section.id} className="wk-sec-card" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1.5px solid var(--lg-line)', paddingBottom: 12, marginBottom: 8 }}>
          <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{section.title}</h2>
          <span className="lg-badge" style={{ fontSize: '.76rem' }}>업데이트 {section.updated}</span>
        </div>
        {section.body}
      </div>
    </div>
  );
}
