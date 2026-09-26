'use client';

import { useEffect, useRef, useState } from 'react';
import { getSelfuseEntries, saveSelfuseReason, saveSelfuseReasonBulk, getLocations } from '@/lib/ledger/queries';
import type { SelfuseEntry } from '@/lib/ledger/queries';
import type { LocationRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';
import { useRole } from '../role-context';

const REASONS = ['시연·촬영', '직원 복지', '매장 비치', '파손 처리', '행사 증정', '기타'];

function SelfuseRow({ entry, onSaved, checked, onToggle }: {
  entry: SelfuseEntry; onSaved: () => void; checked: boolean; onToggle: () => void;
}) {
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
    <tr style={{ borderBottom: '1px solid var(--lg-line-soft)', fontSize: '.85rem', background: isDone ? undefined : checked ? '#FFE9A8' : 'var(--lg-hazel-soft)' }}>
      <td style={{ padding: '9px 6px 9px 14px', width: 28 }}>
        {!isDone && (
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`${entry.product_name} 선택`} />
        )}
      </td>
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
  const { role, locationName } = useRole();
  // 포스 리스트 업로드·엑셀 다운로드는 본사·마스터 전용 — 매장/물류는 사유 입력만
  const canManage = role === 'admin' || role === 'hq';
  // 매니저는 자기 매장 것만 — 매장 선택 드롭다운 없이 로그인 매장으로 고정
  const isManager = role === 'manager';
  const [entries, setEntries] = useState<SelfuseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  // 일괄 입력 — 체크한 미처리 건에 같은 사유·적요 한 번에 저장
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState('');
  const [bulkRemark, setBulkRemark] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkMsg, setBulkMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    if (isManager && !selectedLoc) { setEntries([]); setLoading(false); return; }
    setLoading(true);
    getSelfuseEntries(selectedLoc || undefined)
      .then((rows) => { setEntries(rows); setSelected(new Set()); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    getLocations()
      .then((locs) => setLocations(locs.filter((l) => (l.type === 'store' || l.type === 'popup') && l.active)))
      .catch(() => {});
  }, []);

  // 매니저: 로그인 매장 id로 고정 (매칭 실패 시 빈 목록 — 전체 매장으로 새지 않게)
  const ownLoc = isManager ? locations.find((l) => l.name === locationName) : undefined;
  useEffect(() => {
    if (isManager) setSelectedLoc(ownLoc?.id ?? '');
  }, [isManager, ownLoc?.id]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [selectedLoc, isManager]);

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

  const pending = entries.filter((e) => !e.deducted);
  const needCount = pending.length;
  const allChecked = pending.length > 0 && pending.every((e) => selected.has(e.id));
  const selectedQty = pending.filter((e) => selected.has(e.id)).reduce((s, e) => s + e.qty, 0);

  function toggle(id: string) {
    setBulkMsg('');
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setBulkMsg('');
    setSelected(allChecked ? new Set() : new Set(pending.map((e) => e.id)));
  }

  async function saveBulk() {
    const ids = pending.filter((e) => selected.has(e.id)).map((e) => e.id);
    if (ids.length === 0 || !bulkReason) return;
    const ok = window.confirm(
      `선택한 ${ids.length}건 (총 ${selectedQty}개)을 "${bulkReason}" 사유로 저장합니다.\n` +
      '저장하면 매장 재고에서 차감되고, 되돌리려면 본사에 요청해야 해요.\n\n진행할까요?',
    );
    if (!ok) return;
    setBulkSaving(true); setBulkMsg('');
    try {
      const n = await saveSelfuseReasonBulk(ids, bulkReason, bulkRemark);
      setBulkMsg(`✅ ${n}건 저장 완료`);
      setBulkReason(''); setBulkRemark('');
      load();
    } catch (e) {
      setBulkMsg(`❌ 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBulkSaving(false);
    }
  }
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
          {isManager ? (
            <span className="lg-sub" style={{ fontWeight: 600 }}>{ownLoc?.name ?? '매장 정보 없음'}</span>
          ) : (
          <select
            className="lg-select"
            value={selectedLoc}
            onChange={(e) => setSelectedLoc(e.target.value)}
          >
            <option value="">전체 매장</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          )}
          {canManage && (<>
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
          </>)}
        </div>
      </div>

      {uploadMsg && (
        <div className="lg-card" style={{ background: '#FFF8E1', border: '1px solid #FFD54F', marginBottom: 12, padding: '10px 14px', fontSize: '.83rem' }}>
          ℹ️ {uploadMsg}
        </div>
      )}

      {err && <p className="lg-err">{err}</p>}

      <div className="lg-kpis" style={{ padding: 0 }}>
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
          {needCount > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '10px 14px', marginBottom: 8, background: '#FFF8E1', border: '1px solid #FFD54F', borderRadius: 8, fontSize: '.83rem' }}>
              <strong style={{ whiteSpace: 'nowrap' }}>
                {selected.size > 0 ? `${selected.size}건 선택 (총 ${selectedQty}개)` : '일괄 입력: 체크박스로 여러 건 선택'}
              </strong>
              <select
                className="lg-select"
                value={bulkReason}
                onChange={(e) => setBulkReason(e.target.value)}
                disabled={selected.size === 0}
                style={{ minWidth: 140 }}
              >
                <option value="">사유 선택 *</option>
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <input
                className="lg-input"
                value={bulkRemark}
                onChange={(e) => setBulkRemark(e.target.value)}
                placeholder="상세 메모 (선택)"
                disabled={selected.size === 0}
                style={{ flex: '1 1 160px', minWidth: 140 }}
              />
              <button
                type="button"
                className="lg-btn-ghost"
                style={{ background: 'var(--lg-pine)', color: 'white', border: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
                onClick={saveBulk}
                disabled={bulkSaving || selected.size === 0 || !bulkReason}
              >{bulkSaving ? '저장 중…' : '선택 항목 일괄 저장'}</button>
              {selected.size > 0 && (
                <button type="button" className="lg-btn-ghost" onClick={() => setSelected(new Set())}>선택 해제</button>
              )}
              {bulkMsg && <span style={{ width: '100%' }}>{bulkMsg}</span>}
            </div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--lg-bg)', fontSize: '.72rem', fontWeight: 700, color: 'var(--lg-muted)' }}>
                <th style={{ padding: '8px 6px 8px 14px', width: 28 }}>
                  {needCount > 0 && (
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="전체 선택" title="미처리 전체 선택" />
                  )}
                </th>
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
                <SelfuseRow key={e.id} entry={e} onSaved={load} checked={selected.has(e.id)} onToggle={() => toggle(e.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="lg-hint">노란 칸은 필수값 — 사유 없이 저장할 수 없습니다. 저장 시 매장 재고에서 차감 처리됩니다. 사유가 같은 건은 체크 후 일괄 저장하세요.</p>
    </div>
  );
}
