'use client';

import { useEffect, useState } from 'react';
import { getGachaMachines, getGachaChecks, runGachaCheck } from '@/lib/ledger/queries';
import type { GachaMachine, GachaSlot, GachaCheck } from '@/lib/ledger/queries';

const SHRINKAGE_REASONS = ['뽑기 오류', '분실', '파손', '기타'];

function CheckModal({
  slot,
  onClose,
  onDone,
}: {
  slot: GachaSlot;
  onClose: () => void;
  onDone: () => void;
}) {
  const [counted, setCounted] = useState('');
  const [refill, setRefill] = useState('0');
  const [shrinkage, setShrinkage] = useState('0');
  const [shrinkageReason, setShrinkageReason] = useState('');
  const [cash, setCash] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const cntN = Number(counted);
  const soldEst = slot.qty - cntN;
  const needShrinkageReason = Number(shrinkage) > 0 && !shrinkageReason;

  async function save() {
    if (counted === '') { setErr('실사 수량 필수'); return; }
    if (needShrinkageReason) { setErr('감모 사유 필수'); return; }
    setSaving(true); setErr('');
    try {
      await runGachaCheck(
        slot.id,
        cntN,
        Number(refill),
        Number(shrinkage),
        shrinkageReason || null,
        cash ? Number(cash) : null,
      );
      onDone();
      onClose();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>가챠 점검 — {slot.bin_code} #{slot.slot_no}</h2>
        <p style={{ margin: '0 0 16px', color: 'var(--lg-muted)', fontSize: '.82rem' }}>{slot.product_name ?? '—'} · 직전잔량 {slot.qty}개</p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="lg-label">실사 수량</label>
          <input className="lg-input" type="number" min="0" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder="실제 남은 개수" />

          {counted !== '' && (
            <div style={{ background: 'var(--lg-hazel-soft)', borderRadius: 8, padding: '8px 12px', fontSize: '.82rem' }}>
              판매추정: <strong>{Math.max(0, soldEst)}개</strong>
              {slot.price > 0 && <> · 추정 매출 <strong>{(Math.max(0, soldEst) * slot.price).toLocaleString()}원</strong></>}
            </div>
          )}

          <label className="lg-label">보충 수량</label>
          <input className="lg-input" type="number" min="0" value={refill} onChange={(e) => setRefill(e.target.value)} />

          <label className="lg-label">감모 수량 (판매 외 — 오류·분실·파손)</label>
          <input className="lg-input" type="number" min="0" value={shrinkage} onChange={(e) => setShrinkage(e.target.value)} />

          {Number(shrinkage) > 0 && (
            <>
              <label className="lg-label">감모 사유 *</label>
              <select className="lg-select" value={shrinkageReason} onChange={(e) => setShrinkageReason(e.target.value)}>
                <option value="">선택</option>
                {SHRINKAGE_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </>
          )}

          <label className="lg-label">실수금 (선택)</label>
          <input className="lg-input" type="number" min="0" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="수금한 현금 총액" />
        </div>

        {err && <p className="lg-err" style={{ marginTop: 10, fontSize: '.8rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="lg-btn-ghost" onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving} onClick={save}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MachineCard({ machine, onRefresh }: { machine: GachaMachine; onRefresh: () => void }) {
  const [checkSlot, setCheckSlot] = useState<GachaSlot | null>(null);
  const lowCount = machine.slots.filter((s) => s.qty < 10).length;
  const totalQty = machine.slots.reduce((s, sl) => s + sl.qty, 0);

  return (
    <div className="lg-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="ledger lg-card-h" style={{ padding: '12px 16px' }}>
        <span>{machine.bin_code}</span>
        {lowCount > 0 && (
          <span className="lg-badge" style={{ background: 'var(--lg-rust-soft)', color: 'var(--lg-rust)' }}>
            잔량 부족 {lowCount}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '.8rem', color: 'var(--lg-muted)' }}>총 {totalQty}개</span>
      </div>
      {machine.slots.map((s) => (
        <div key={s.id} className="ledger lg-lg" style={{ padding: '8px 16px' }}>
          <span style={{ flex: '0 0 28px', color: 'var(--lg-muted)', fontSize: '.78rem', fontWeight: 700 }}>#{s.slot_no}</span>
          <span style={{ flex: 1 }}>{s.product_name ?? <em style={{ color: 'var(--lg-faint)' }}>미설정</em>}</span>
          {s.price > 0 && <span style={{ flex: '0 0 auto', color: 'var(--lg-muted)', fontSize: '.78rem' }}>{s.price.toLocaleString()}원</span>}
          <span
            style={{
              flex: '0 0 36px', textAlign: 'right',
              fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: s.qty < 10 ? 'var(--lg-rust)' : undefined,
            }}
          >
            {s.qty}
          </span>
          <button className="lg-btn-ghost" style={{ flex: '0 0 auto', padding: '4px 10px', fontSize: '.78rem' }} onClick={() => setCheckSlot(s)}>
            점검
          </button>
        </div>
      ))}
      {checkSlot && (
        <CheckModal slot={checkSlot} onClose={() => setCheckSlot(null)} onDone={onRefresh} />
      )}
    </div>
  );
}

function HistoryRow({ c }: { c: GachaCheck }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid var(--lg-line-soft)', fontSize: '.82rem', flexWrap: 'wrap' }}>
      <span style={{ flex: '0 0 110px', color: 'var(--lg-muted)', fontSize: '.75rem' }}>
        {new Date(c.checked_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
      <span style={{ flex: '0 0 auto', fontWeight: 700 }}>{c.bin_code} #{c.slot_no}</span>
      <span style={{ flex: 1, color: 'var(--lg-muted)' }}>{c.product_name}</span>
      <span>실사 {c.counted} → 보충 +{c.refill}</span>
      <span style={{ color: 'var(--lg-hazel)' }}>판매추정 {c.sold_est}개 / {c.revenue_est.toLocaleString()}원</span>
      {c.shrinkage > 0 && (
        <span style={{ color: 'var(--lg-rust)', fontSize: '.75rem' }}>감모 {c.shrinkage} ({c.shrinkage_reason})</span>
      )}
    </div>
  );
}

export function GachaScreen() {
  const [machines, setMachines] = useState<GachaMachine[]>([]);
  const [history, setHistory] = useState<GachaCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  function load() {
    Promise.all([getGachaMachines(), getGachaChecks()])
      .then(([m, h]) => { setMachines(m); setHistory(h); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  const totalSlots = machines.reduce((s, m) => s + m.slots.length, 0);
  const totalQty = machines.reduce((s, m) => s + m.slots.reduce((ss, sl) => ss + sl.qty, 0), 0);
  const lowSlots = machines.reduce((s, m) => s + m.slots.filter((sl) => sl.qty < 10).length, 0);
  const totalRevenue = history.reduce((s, c) => s + c.revenue_est, 0);

  return (
    <div>
      <div className="lg-page-head">
        <p className="lg-sub">머신 위치·번호·품목 — 보충과 점검을 기록</p>
      </div>

      {err && <p className="lg-err">{err}</p>}

      <div className="ledger lg-kpis" style={{ padding: 0 }}>
        <div className="lg-kpi">
          <div className="lg-kl">머신</div>
          <div className="lg-kv">{loading ? '…' : machines.length}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">슬롯</div>
          <div className="lg-kv">{loading ? '…' : totalSlots}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">머신 내 잔량 합</div>
          <div className="lg-kv">{loading ? '…' : totalQty}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">잔량 10개 미만 슬롯</div>
          <div className="lg-kv lg-warn">{loading ? '…' : lowSlots}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">판매추정 매출 (누계)</div>
          <div className="lg-kv">{loading ? '…' : `${totalRevenue.toLocaleString()}원`}</div>
        </div>
      </div>

      {loading ? (
        <p className="lg-empty">불러오는 중…</p>
      ) : machines.length === 0 ? (
        <div className="lg-card lg-empty" style={{ marginTop: 12 }}>등록된 머신 없음<br /><span style={{ fontSize: '.8rem', color: 'var(--lg-muted)' }}>bins + gacha_slots 데이터 확인</span></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(340px,1fr))', gap: 12, marginTop: 12 }}>
          {machines.map((m) => (
            <MachineCard key={m.bin_id} machine={m} onRefresh={load} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="lg-card" style={{ marginTop: 14 }}>
          <div className="ledger lg-card-h" style={{ padding: '12px 16px', borderBottom: '1px solid var(--lg-line-soft)' }}>
            가챠 이력 <span className="lg-sub">최근 50건</span>
          </div>
          {history.map((c) => <HistoryRow key={c.id} c={c} />)}
        </div>
      )}

      <p className="lg-hint">
        판매추정 = 직전 잔량 − 실사 잔량. 보충은 매장 재고 → 머신 이동, 품목 변경 시 잔량은 매장으로 회수됩니다.
      </p>
    </div>
  );
}
