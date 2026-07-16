'use client';

import { useRef, useState } from 'react';

// 엑셀 업로드 공용 모달 — 파일 선택 → 서버 미리보기(매칭 결과) → 적용.
// 서버 라우트는 FormData(file, mode='preview'|'apply')를 받아
//   preview: { summary:{matched,unmatched,totalQty}, rows:[{name,code,qty,status,detail}] }
//   apply:   { message, orderNo?, applied, quarantined }
// 를 반환한다. 재고를 차감·전표를 생성하므로 반드시 미리보기 확인 후 적용한다.

interface PreviewRow { name: string; code: string; qty: number; status: 'matched' | 'unmatched'; detail: string; }
interface PreviewResp { summary: { matched: number; unmatched: number; totalQty: number }; rows: PreviewRow[]; }

export function UploadPreviewModal({
  title, description, endpoint, applyLabel, onClose, onDone,
}: {
  title: string;
  description: string;
  endpoint: string;
  applyLabel: string;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function runPreview(f: File) {
    setBusy(true); setErr(''); setPreview(null);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('mode', 'preview');
      const res = await fetch(endpoint, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '미리보기 실패');
      setPreview(json as PreviewResp);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    runPreview(f);
  }

  async function apply() {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'apply');
      const res = await fetch(endpoint, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '적용 실패');
      onDone(json.message ?? '✅ 적용 완료');
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const canApply = !!preview && preview.summary.matched > 0 && !busy;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>{title}</h2>
        <p style={{ margin: '0 0 16px', color: 'var(--lg-muted)', fontSize: '.8rem' }}>{description}</p>

        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFile} />

        {!preview && (
          <button
            type="button"
            className="lg-btn-ghost"
            style={{ width: '100%', padding: '14px', border: '1.5px dashed var(--lg-line)' }}
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? '분석 중…' : file ? `${file.name} — 다시 선택` : '📁 엑셀 파일 선택 (.xlsx / .csv)'}
          </button>
        )}

        {preview && (
          <>
            <div className="lg-card" style={{ padding: '10px 14px', marginBottom: 12, display: 'flex', gap: 16, fontSize: '.85rem', flexWrap: 'wrap' }}>
              <span>매칭 <strong style={{ color: 'var(--lg-pine)' }}>{preview.summary.matched}</strong>개 품목</span>
              <span>총 <strong>{preview.summary.totalQty}</strong>개</span>
              {preview.summary.unmatched > 0 && (
                <span style={{ color: 'var(--lg-rust)' }}>검역 예정 <strong>{preview.summary.unmatched}</strong>건</span>
              )}
              <button type="button" className="lg-btn-ghost" style={{ marginLeft: 'auto', fontSize: '.78rem', padding: '4px 10px' }}
                disabled={busy} onClick={() => fileRef.current?.click()}>다른 파일</button>
            </div>

            <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--lg-line)', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                <thead>
                  <tr style={{ background: 'var(--lg-bg)', fontSize: '.72rem', fontWeight: 700, color: 'var(--lg-muted)', position: 'sticky', top: 0 }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px' }}>상품</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px' }}>코드</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px' }}>수량</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px' }}>결과</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--lg-line-soft)', background: r.status === 'unmatched' ? '#FAE7E4' : undefined }}>
                      <td style={{ padding: '7px 12px' }}>{r.name}</td>
                      <td style={{ padding: '7px 12px', fontFamily: 'monospace', fontSize: '.75rem', color: 'var(--lg-muted)' }}>{r.code || '—'}</td>
                      <td style={{ padding: '7px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.qty}</td>
                      <td style={{ padding: '7px 12px', color: r.status === 'unmatched' ? 'var(--lg-rust)' : 'var(--lg-pine)', fontSize: '.78rem' }}>
                        {r.status === 'matched' ? '✓ ' : '✗ '}{r.detail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {err && <p className="lg-err" style={{ marginTop: 12, fontSize: '.8rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="lg-btn-ghost" onClick={onClose} disabled={busy}>취소</button>
          <button type="button" className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={!canApply} onClick={apply}>
            {busy ? '처리 중…' : applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
