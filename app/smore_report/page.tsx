import type { Metadata } from 'next';
import { SmoreReport } from '@/components/ledger/smore-report';

// 매출 대시보드 — OPS 메뉴에 없는 별도 페이지 (본사·마스터 전용, 2026-09-29 나츠)
export const metadata: Metadata = {
  title: 'SMORE Report',
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SmoreReport />;
}
