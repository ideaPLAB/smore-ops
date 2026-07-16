'use client';

import { useEffect, useState } from 'react';
import { getLocations, SupabaseMissingError } from '@/lib/ledger/queries';
import type { LocationRow } from '@/lib/ledger/types';

const PERMISSION_ROWS = [
  { menu: '발주판 (최종수량 입력)', manager: '소속 매장', warehouse: '—', hq: '전체 + 확정' },
  { menu: '재고 현황', manager: '소속 매장', warehouse: '창고', hq: '전체' },
  { menu: '입고검수 · 자가사용 · 가챠', manager: '소속 매장', warehouse: '—', hq: '전체' },
  { menu: '출고 대기열 · 입고 처리', manager: '—', warehouse: '창고 작업', hq: '전체' },
  { menu: '상품관리 · 계정 관리', manager: '—', warehouse: '—', hq: '본사·마스터' },
];

function locationTypeLabel(type: string) {
  if (type === 'store') return '상설';
  if (type === 'popup') return '팝업';
  if (type === 'warehouse') return '창고';
  if (type === 'zerozone') return '제로존';
  return type;
}

export function AccountsScreen() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  async function load() {
    try {
      const data = await getLocations();
      setLocations(data);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { load(); }, []);

  const activeLocations = locations.filter((l) => l.active);
  const inactiveLocations = locations.filter((l) => !l.active);

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">매장·물류·본사 계정 발급과 권한 — 마스터 계정만 접근</p>
        </div>
      </div>

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && <div className="lg-card lg-empty">Supabase 환경 변수 없음 — <code>.env.local</code> 설정 필요</div>}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          {/* 매장 현황 */}
          <div className="lg-card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '.88rem', padding: '12px 16px 10px', borderBottom: '1px solid var(--lg-line)' }}>
              매장 현황
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--lg-muted)', fontWeight: 600 }}>이름</th>
                  <th style={{ textAlign: 'left', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 }}>유형</th>
                  <th style={{ textAlign: 'left', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 }}>이카운트 코드</th>
                  <th style={{ textAlign: 'left', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 }}>팝업 마감</th>
                  <th style={{ textAlign: 'center', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 }}>상태</th>
                </tr>
              </thead>
              <tbody>
                {activeLocations.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--lg-line)' }}>
                    <td style={{ padding: '8px 16px', fontWeight: 600 }}>{l.name}</td>
                    <td style={{ padding: '8px', color: 'var(--lg-muted)' }}>{locationTypeLabel(l.type)}</td>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{l.ecount_code ?? '—'}</td>
                    <td style={{ padding: '8px', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{l.closes_at ?? '—'}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span className="lg-tag">활성</span>
                    </td>
                  </tr>
                ))}
                {inactiveLocations.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--lg-line)', opacity: 0.45 }}>
                    <td style={{ padding: '8px 16px' }}>{l.name}</td>
                    <td style={{ padding: '8px', color: 'var(--lg-muted)' }}>{locationTypeLabel(l.type)}</td>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{l.ecount_code ?? '—'}</td>
                    <td style={{ padding: '8px', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{l.closes_at ?? '—'}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span className="lg-tag lg-tag-dev">비활성</span>
                    </td>
                  </tr>
                ))}
                {locations.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: 'var(--lg-muted)' }}>등록된 매장이 없습니다</td></tr>
                )}
              </tbody>
            </table>
            <div style={{ padding: '10px 16px', fontSize: '.75rem', color: 'var(--lg-muted)', borderTop: '1px solid var(--lg-line)' }}>
              매장 추가·수정은 Supabase Auth 계정 관리와 함께 순차 오픈 예정입니다.
            </div>
          </div>

          {/* 계정 발급 안내 */}
          <div className="lg-card" style={{ marginBottom: 14, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, fontSize: '.88rem', marginBottom: 8 }}>새 계정 발급</div>
            <div style={{ fontSize: '.82rem', color: 'var(--lg-muted)', background: 'var(--lg-bg)', borderRadius: 8, padding: '12px 14px', lineHeight: 1.7 }}>
              계정 발급 기능은 Supabase Auth 연동 후 활성화됩니다.<br />
              현재 프로토타입에서는 역할 드롭다운으로 화면을 전환해 기능을 확인할 수 있습니다.<br />
              배포판에서는 역할(manager / warehouse / hq)과 소속 매장을 지정해 초대 링크를 발송합니다.
            </div>
          </div>

          {/* 역할별 권한 요약 */}
          <div className="lg-card">
            <div style={{ fontWeight: 700, fontSize: '.88rem', padding: '12px 16px 10px', borderBottom: '1px solid var(--lg-line)' }}>
              역할별 권한 요약
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--lg-muted)', fontWeight: 600 }}>메뉴</th>
                  <th style={{ textAlign: 'center', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 }}>매장 매니저</th>
                  <th style={{ textAlign: 'center', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 }}>물류</th>
                  <th style={{ textAlign: 'center', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 }}>본사</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ROWS.map((r) => (
                  <tr key={r.menu} style={{ borderTop: '1px solid var(--lg-line)' }}>
                    <td style={{ padding: '8px 16px' }}>{r.menu}</td>
                    <td style={{ padding: '8px', textAlign: 'center', color: r.manager === '—' ? 'var(--lg-muted)' : undefined }}>{r.manager}</td>
                    <td style={{ padding: '8px', textAlign: 'center', color: r.warehouse === '—' ? 'var(--lg-muted)' : undefined }}>{r.warehouse}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontWeight: 600 }}>{r.hq}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ padding: '10px 16px', fontSize: '.75rem', color: 'var(--lg-muted)', borderTop: '1px solid var(--lg-line)', margin: 0 }}>
              권한은 화면 숨김에 그치지 않고 데이터 접근 자체를 DB(RLS)에서 차단합니다.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
