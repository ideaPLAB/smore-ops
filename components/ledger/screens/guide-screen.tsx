'use client';

import { useRole } from '../role-context';
import type { Role } from '@/lib/ledger/roles';

type GuideSection = { title: string; body: string };

const GUIDES: Record<Role, GuideSection[]> = {
  manager: [
    {
      title: '매주 발주',
      body: '발주판에서 매장별 최종수량 확인·입력 → 제안과 다르면 이탈 사유 선택 → [입력 내용 최종 확인] → [발주 확정 · 전표 생성]. 창고분은 출고요청, 업체분은 구매발주 전표로 자동 분리됩니다. 판매 데이터가 7일 이상 갱신되지 않으면 확정이 차단됩니다 — 먼저 판매 업로드.',
    },
    {
      title: '입고검수',
      body: '출고지시가 도착하면 입고검수 화면에서 전표를 열어 라인별 실수량을 입력합니다. 수량 차이가 있으면 사유를 선택하고 저장하세요. 창고 원장은 검수 확인 즉시 반영됩니다.',
    },
    {
      title: '자가사용 처리',
      body: '직원 복지·시연·파손 등으로 판매 목적 외 상품을 사용하면 자가사용 처리 화면에서 사유를 입력해 차감합니다. 사유 미입력 시 저장되지 않습니다.',
    },
    {
      title: '가챠머신 관리',
      body: '가챠머신 관리 화면에서 슬롯별 재고를 주기적으로 실사합니다. 실사 수량 → 리필 수량 → 감모 수량(판매 외 손실)을 입력하면 재고가 자동 조정됩니다.',
    },
    {
      title: '재고 현황',
      body: '재고 현황 화면에서 소속 매장의 상품별 재고와 이동중 수량을 실시간으로 확인할 수 있습니다.',
    },
  ],
  warehouse: [
    {
      title: '출고 대기열',
      body: '출고요청이 생성되면 출고 대기열에 나타납니다. 실제 포장·출고 후 라인별 [출고 처리]를 눌러 수량을 확정합니다. 수량이 다르면 직접 수정해 저장하세요.',
    },
    {
      title: '입고 처리',
      body: '공급업체에서 창고로 물품이 도착하면 입고 처리 화면에서 전표를 열어 라인별 실수량을 입력합니다. 이카운트 구매입고 엑셀 업로드로 전표를 일괄 생성할 수도 있습니다.',
    },
    {
      title: '재고 현황',
      body: '창고 재고를 실시간으로 확인합니다. 이동중 탭에서 각 매장으로 이동 중인 수량도 확인할 수 있습니다.',
    },
  ],
  hq: [
    {
      title: '발주 라운드 운영',
      body: '발주판 상단에서 [라운드 개설]을 눌러 마감일을 설정합니다. 매니저들이 최종수량을 입력하면 [입력 내용 최종 확인] 후 [발주 확정]으로 전표를 생성합니다.',
    },
    {
      title: '판매 데이터 업로드',
      body: 'POS 판매 파일을 판매 데이터 업로드 화면에 올리면 주간·월간 판매가 갱신되고 발주판 제안수량이 재계산됩니다. 판매 데이터가 7일 이상 오래되면 발주 확정이 차단됩니다.',
    },
    {
      title: '출고요청',
      body: '창고에서 매장으로 상품을 이동할 때 출고요청 화면에서 상품·수량·목적지를 선택해 전표를 생성합니다. 팝업 초도 물량은 대량이므로 발주판 대신 이 화면을 주로 사용합니다.',
    },
    {
      title: '이동중 현황',
      body: '발주(qty_ordered)·물류출고(qty_shipped)·검수(qty_received) 세 숫자를 3-way 대사로 보여줍니다. 일치하지 않으면 어느 단계에서 차이가 생겼는지 즉시 파악할 수 있습니다.',
    },
  ],
  admin: [
    {
      title: '마스터 계정',
      body: '모든 화면과 기능에 접근할 수 있습니다. 상품관리에서 발주가능·발주단위를 조정하고, 계정 관리에서 매장과 사용자 계정을 관리합니다.',
    },
  ],
};

const ROLE_SUBTITLE: Record<Role, string> = {
  admin: '마스터 — 전체 권한',
  hq: '본사 담당자 가이드',
  manager: '매장 매니저 가이드',
  warehouse: '물류 담당자 가이드',
};

export function GuideScreen() {
  const { role } = useRole();
  const sections = GUIDES[role] ?? [];

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">{ROLE_SUBTITLE[role]}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {sections.map((s) => (
          <div key={s.title} className="lg-card" style={{ padding: '16px 20px' }}>
            <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: 8, color: 'var(--lg-pine)' }}>
              {s.title}
            </div>
            <p style={{ fontSize: '.84rem', lineHeight: 1.7, margin: 0, color: 'var(--lg-text)' }}>
              {s.body}
            </p>
          </div>
        ))}

        {sections.length === 0 && (
          <div className="lg-card lg-empty">이 역할의 가이드가 아직 없습니다.</div>
        )}
      </div>
    </section>
  );
}
