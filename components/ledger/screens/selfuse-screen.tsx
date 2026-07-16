'use client';

import { useEffect, useRef, useState } from 'react';
import { getSelfuseEntries, saveSelfuseReason, getLocations } from '@/lib/ledger/queries';
import type { SelfuseEntry } from '@/lib/ledger/queries';
import type { LocationRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

const REASONS = ['시연·촬영', '직원 복지', '매장 비치', '파손 처리', '행사 증정', '기타'];

function SelfuseRow({ entry, onSaved }: { entry: SelfuseEntry; onSaved: () => void }) {
  const [reason, setReason] = useState(entry.reason ?? '');
  const [remark, setRemark] = useState(entry.remark ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const isDone = entry.deducted;

  async function save() {
    if (!reason) { setErr('사유 필수'); return; }
    setSaving(true); setErr('');
    try {
      await saveSelfuseReason(entry.id, reason, remark);
      onSaved();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr style={{ borderBottom: '1px solid var(--lg-line-soft)', fontSize: '.85rem', background: isDone ? undefined : 'var(--lg-hazel-soft)' }}>
      <td style={{ padding: '9px 14px', whiteSpace: 'nowrap' }}>{entry.entry_date}</td>
      <td style={{ padding: '9px 14px', fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{entry.sku}</td>
      <td style={{ padding: '9px 14px' }}>{entry.product_name}</td>
      <td style={{ padding: '9px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{entry.qty}</td>
      <td style={{ padding: '9px 14px', minWidth: 160 }}>
        {isDone ? (
          <span style={{ color: 'var(--lg-muted)' }}>{entry.reason}</span>
        ) : (
          <select
            className="lg-select"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ width: '100%', background: !reason ? '#FFF3C4' : undefined }}
          >
            <option value="">사유 선택 *</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        )}
      </td>
      <td style={{ padding: '9px 14px', minWidth: 160 }}>
        {isDone ? (
          <span style={{ color: 'var(--lg-muted)' }}>{entry.remark ?? '—'}</span>
        ) : (
          <input
            className="lg-input"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="상세 메모"
            style={{ width: '100%' }}
          />
        )}
      </td>
      <td style={{ padding: '9px 14px' }}>
        {isDone ? (
          <span style={{ color: 'var(--lg-pine)', fontWeight: 700, fontSize: '.78rem' }}>✓ 차감 완료</span>
        ) : (
          <button className="lg-btn-ghost" disabled={saving || !reason} onClick={save} style={{ whiteSpace: 'nowrap' }}>
            {saving ? '저장 중…' : '저장'}
          </button>
        )}
        {err && <div className="lg-err" style={{ fontSize: '.72rem', marginTop: 2 }}>{err}</div>}
      </td>
    </tr>
  );
}

export function SelfuseScreen() {
  const [entries, setEntries] = useState<SelfuseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    getSelfuseEntries(selectedLoc || undefined)
      .then(setEntries)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    getLocations()
      .then((locs) => setLocations(locs.filter((l) => (l.type === 'store' || l.type === 'popup') && l.active)))
      .catch(() => {});
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [selectedLoc]);

  function handleUploadClick() {
    // 전체 매장 상태면 파일에 매장 컬럼이 없을 때 전부 "매장 불명"으로 걸러짐 → 먼저 안내.
    if (!selectedLoc) {
      const go = window.confirm(
        '매장이 "전체 매장"으로 선택돼 있어요.\n\n' +
        '포스 파일에 [매장] 컬럼이 없으면 "매장 불명"으로 등록이 되지 않습니다.\n' +
        '위 드롭다운에서 먼저 매장을 선택하는 걸 권장해요.\n\n' +
        '그래도 진행할까요? (파일에 매장 컬럼이 있으면 그대로 진행 가능)',
      );
      if (!go) { setUploadMsg('업로드 취소됨 — 위 드롭다운에서 매장을 먼저 선택해 주세요.'); return; }
    }
    fileRef.current?.click();
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMsg('업로드 중…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (selectedLoc) fd.append('locationId', selectedLoc); // 선택 매장을 기본 매장으로
      const res = await fetch('/api/selfuse/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '업로드 실패');
      const skip = json.skipped ? ` (제외 ${json.skipped}건${json.skippedSample?.length ? ': ' + json.skippedSample.join(', ') : ''})` : '';
      setUploadMsg(`✅ ${json.count}건 등록 완료 — 사유 입력해 주세요${skip}`);
      await load();
    } catch (err) {
      setUploadMsg(`❌ 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleDownload() {
    const headers = ['일자', '품목코드', '품목명', '수량', '처리사유', '적요', '상태'];
    const rows = entries.map((e) => [
      e.entry_date,
      e.sku,
      e.product_name,
      e.qty,
      e.reason ?? '',
      e.remark ?? '',
      e.deducted ? '차감 완료' : '입력 필요',
    ]);
    downloadCsv('자가사용.csv', headers, rows);
  }

  const needCount = entries.filter((e) => !e.deducted).length;
  const doneCount = entries.filter((e) => e.deducted).length;

  // 마감일: 매달 5일까지 전월분
  const now = new Date();
  const deadlineMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const deadlineYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  return (
    <div>
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="lg-sub">포스 자가사용 내역 — 매달 5일까지 전월분 사유 입력</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            className="lg-select"
            value={selectedLoc}
            onChange={(e) => setSelectedLoc(e.target.value)}
          >
            <option value="">전체 매장</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button
            type="button"
            className="lg-btn-ghost"
            style={{ background: 'var(--lg-pine)', color: 'white', border: 'none', fontWeight: 600 }}
            onClick={handleUploadClick}
          >포스 자가사용 리스트 업로드</button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleUpload} />
          <button
            type="button"
            className="lg-btn-ghost"
            onClick={handleDownload}
            disabled={entries.length === 0}
            title="내보낼 데이터가 없습니다"
          >⬇ 엑셀 다운로드</button>
        </div>
      </div>

      {uploadMsg && (
        <div className="lg-card" style={{ background: '#FFF8E1', border: '1px solid #FFD54F', marginBottom: 12, padding: '10px 14px', fontSize: '.83rem' }}>
          ℹ️ {uploadMsg}
        </div>
      )}

      {err && <p className="lg-err">{err}</p>}

      <div className="ledger lg-kpis" style={{ padding: 0 }}>
        <div className="lg-kpi">
          <div className="lg-kl" style={{ color: 'var(--lg-rust)', fontWeight: 700 }}>입력 필요</div>
          <div className="lg-kv lg-bad">{loading ? '…' : needCount}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">처리 완료</div>
          <div className="lg-kv">{loading ? '…' : doneCount}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">이번 달 마감</div>
          <div className="lg-kv" style={{ fontSize: '1rem', paddingTop: 6 }}>
            {deadlineYear}/{String(deadlineMonth).padStart(2, '0')}월분
          </div>
        </div>
      </div>

      {loading ? (
        <p className="lg-empty">불러오는 중…</p>
      ) : entries.length === 0 ? (
        <div className="lg-card lg-empty" style={{ marginTop: 12 }}>자가사용 내역 없음</div>
      ) : (
        <div className="lg-card" style={{ marginTop: 12, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--lg-bg)', fontSize: '.72rem', fontWeight: 700, color: 'var(--lg-muted)' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>일자</th>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>SKU</th>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>상품명</th>
                <th style={{ textAlign: 'right', padding: '8px 14px' }}>수량</th>
                <th style={{ textAlign: 'left', padding: '8px 14px', background: '#FFF3C4' }}>
                  처리사유 <span style={{ color: 'var(--lg-rust)' }}>*필수</span>
                </th>
                <th style={{ textAlign: 'left', padding: '8px 14px' }}>적요 (상세)</th>
                <th style={{ padding: '8px 14px' }}></th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <SelfuseRow key={e.id} entry={e} onSaved={load} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="lg-hint">노란 칸은 필수값 — 사유 없이 저장할 수 없습니다. 저장 시 매장 재고에서 차감 처리됩니다.</p>
    </div>
  );
}
