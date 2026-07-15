'use client';

import { useEffect, useState } from 'react';
import { getSelfuseEntries, saveSelfuseReason } from '@/lib/ledger/queries';
import type { SelfuseEntry } from '@/lib/ledger/queries';

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

  function load() {
    getSelfuseEntries()
      .then(setEntries)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const needCount = entries.filter((e) => !e.deducted).length;
  const doneCount = entries.filter((e) => e.deducted).length;

  // 마감일: 매달 5일까지 전월분
  const now = new Date();
  const deadlineMonth = now.getMonth() === 0 ? 12 : now.getMonth();
  const deadlineYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  return (
    <div>
      <div className="lg-page-head">
        <p className="lg-sub">포스 자가사용 내역 — 매달 5일까지 전월분 사유 입력</p>
      </div>

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
