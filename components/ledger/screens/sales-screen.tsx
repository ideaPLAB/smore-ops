'use client';

import { useEffect, useRef, useState } from 'react';
import { getSalesAsof, getSalesUploadHistory, SupabaseMissingError } from '@/lib/ledger/queries';
import type { SalesUploadStat } from '@/lib/ledger/queries';

export function SalesScreen() {
  const [asof, setAsof] = useState<string | null>(null);
  const [history, setHistory] = useState<SalesUploadStat[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [a, h] = await Promise.all([getSalesAsof(), getSalesUploadHistory()]);
      setAsof(a);
      setHistory(h);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { load(); }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    setUploadMsg('파일 파싱 기능은 n8n 연동 후 활성화됩니다. 현재는 수동 업로드 경로 준비 중입니다.');
  }

  function handleFile() {
    setUploadMsg('파일 파싱 기능은 n8n 연동 후 활성화됩니다. 현재는 수동 업로드 경로 준비 중입니다.');
  }

  const daysSinceAsof = asof
    ? Math.floor((Date.now() - new Date(asof).getTime()) / 86400000)
    : null;
  const isStale = daysSinceAsof != null && daysSinceAsof > 7;

  const totalRows = history.reduce((s, h) => s + h.row_count, 0);

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">POS 판매 내역을 올리면 주간·월간 판매와 제안수량이 재계산됩니다</p>
        </div>
        <div>
          <button
            type="button"
            className="lg-btn-main"
            onClick={() => fileRef.current?.click()}
          >
            POS 판매 파일 업로드
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={handleFile} />
        </div>
      </div>

      {isStale && (
        <div className="lg-banner-warn">
          ⚠ 판매 데이터가 {daysSinceAsof}일 경과 — 제안수량 신뢰 불가. 판매 파일을 업로드해 주세요.
        </div>
      )}

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && <div className="lg-card lg-empty">Supabase 환경 변수 없음 — <code>.env.local</code> 설정 필요</div>}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          <div className="lg-kpis">
            <div className="lg-kpi">
              <div className="lg-kl">판매 데이터 기준일</div>
              <div className="lg-kv" style={{ fontSize: '1rem', paddingTop: 6 }}>
                {asof ?? '—'}
                {isStale && <span style={{ marginLeft: 8, fontSize: '.8rem', color: 'var(--lg-rust)' }}>{daysSinceAsof}일 경과</span>}
              </div>
            </div>
            <div className="lg-kpi">
              <div className="lg-kl">DB 저장 행</div>
              <div className="lg-kv">{totalRows.toLocaleString()}</div>
            </div>
          </div>

          {/* 드롭존 */}
          <div
            className="lg-card"
            style={{
              border: `2px dashed ${dragging ? 'var(--lg-pine)' : 'var(--lg-line)'}`,
              background: dragging ? 'var(--lg-bg)' : undefined,
              textAlign: 'center',
              padding: '32px 16px',
              marginBottom: 16,
              cursor: 'pointer',
              transition: 'border-color .15s',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--lg-pine)', marginBottom: 6 }}>
              POS 파일을 여기에 드래그하거나 클릭해 선택
            </p>
            <p style={{ fontSize: '.8rem', color: 'var(--lg-muted)' }}>
              포스상품번호 → 바코드 순 매칭 · 매칭 실패 건은 검역 보관 후 재적용 가능
            </p>
          </div>

          {uploadMsg && (
            <div className="lg-card" style={{ background: '#FFF8E1', border: '1px solid #FFD54F', marginBottom: 16, padding: '12px 16px', fontSize: '.84rem' }}>
              ℹ️ {uploadMsg}
            </div>
          )}

          {/* 업로드 이력 */}
          <div className="lg-card">
            <div style={{ fontWeight: 700, fontSize: '.88rem', padding: '12px 16px 8px', borderBottom: '1px solid var(--lg-line)' }}>
              판매 데이터 이력 (날짜별)
            </div>
            {history.length === 0 ? (
              <div className="lg-empty" style={{ padding: '20px 16px' }}>아직 데이터가 없습니다</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--lg-muted)', fontWeight: 600 }}>판매일</th>
                    <th style={{ textAlign: 'right', padding: '8px 16px', color: 'var(--lg-muted)', fontWeight: 600 }}>행 수</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.sale_date} style={{ borderTop: '1px solid var(--lg-line)' }}>
                      <td style={{ padding: '8px 16px', fontFamily: 'monospace' }}>{h.sale_date}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right' }}>{h.row_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="lg-hint" style={{ marginTop: 12, fontSize: '.76rem', color: 'var(--lg-muted)' }}>
            매칭은 포스상품번호 → 바코드 순서로 시도합니다. 실패 건은 검역 목록에 보관됩니다.
            n8n 자동화 연결 후에는 매일 아침 자동 반영되며 이 화면은 비상용 수동 통로로 유지됩니다.
          </p>
        </>
      )}
    </section>
  );
}
