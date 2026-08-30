'use client';

import { useEffect, useState } from 'react';
import { getGachaMachines, getGachaChecks, getGachaRevenueTotal, runGachaCheck, undoGachaCheck, getLocations, getAllProducts, changeGachaSlot, recoverGachaSlot, createGachaMachine, updateGachaMachine, deleteGachaMachine, setGachaStockAsOf, getGachaSlotHistories } from '@/lib/ledger/queries';
import type { GachaMachine, GachaSlot, GachaCheck, GachaSlotHistory } from '@/lib/ledger/queries';
import type { LocationRow, ProductRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';
import { useRole } from '../role-context';

interface LastAction {
  slot: GachaSlot;
  prevQty: number;
}

const SHRINKAGE_REASONS = ['뽑기 오류', '분실', '파손', '기타'];
void SHRINKAGE_REASONS; // 보충 전용으로 단순화 — 감모 입력 제거

function ProductSearch({
  products,
  value,
  onChange,
}: {
  products: ProductRow[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [query, setQuery] = useState(() => {
    const found = products.find((p) => p.id === value);
    return found ? `${found.name} (${found.sku})` : '';
  });
  const [open, setOpen] = useState(false);

  const filtered = query.trim()
    ? products.filter((p) => {
        const q = query.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcode ?? '').toLowerCase().includes(q) ||
          (p.product_code ?? '').toLowerCase().includes(q)
        );
      }).slice(0, 100)
    : products.slice(0, 50);

  function select(p: ProductRow) {
    onChange(p.id);
    setQuery(`${p.name} (${p.sku})`);
    setOpen(false);
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        className="lg-input"
        placeholder="상품명·바코드·상품코드 검색"
        value={query}
        onChange={(e) => { setQuery(e.target.value); onChange(''); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          background: 'white', border: '1px solid var(--lg-line)', borderRadius: 8,
          maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,.12)',
        }}>
          {filtered.map((p) => (
            <div
              key={p.id}
              onMouseDown={() => select(p)}
              style={{
                padding: '8px 12px', fontSize: '.82rem', cursor: 'pointer',
                borderBottom: '1px solid var(--lg-line-soft)',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--lg-surface)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ''; }}
            >
              <span style={{ fontWeight: 500 }}>{p.name}</span>
              <span style={{ color: 'var(--lg-muted)', marginLeft: 6, fontSize: '.75rem' }}>{p.sku}{p.barcode ? ` · ${p.barcode}` : ''}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


function SlotChangeModal({
  slot,
  products,
  onClose,
  onDone,
}: {
  slot: GachaSlot;
  products: ProductRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [productId, setProductId] = useState(slot.product_id ?? '');
  const [price, setPrice] = useState(String(slot.price));
  const [remark, setRemark] = useState(slot.remark ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!productId) { setErr('품목을 선택해 주세요'); return; }
    const p = Number(price);
    if (isNaN(p) || p < 0) { setErr('판매가를 확인해 주세요'); return; }
    if (slot.qty > 0 && !window.confirm(`잔량 ${slot.qty}개는 판매(소멸) 처리됩니다.\n재고로 돌아가지 않습니다.\n\n※ 위치만 옮기려면 '회수' 버튼을 쓰세요. 계속하시겠습니까?`)) return;
    setSaving(true); setErr('');
    try {
      await changeGachaSlot(slot.id, productId, p, remark);
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '90%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>품목변경 — {slot.bin_code} #{slot.slot_no}</h2>
        {slot.qty > 0 && (
          <p style={{ margin: '0 0 14px', fontSize: '.8rem', color: 'var(--lg-hazel)' }}>
            ⚠ 잔량 {slot.qty}개는 품목 변경 시 판매(소멸) 처리됩니다. 재고로 돌아가지 않습니다. 위치만 옮기려면 &lsquo;회수&rsquo; 버튼을 쓰세요.
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="lg-label">품목 검색</label>
          <ProductSearch products={products} value={productId} onChange={setProductId} />
          <label className="lg-label">판매가 (원)</label>
          <input className="lg-input" type="number" min="0" step="100" value={price} onChange={(e) => setPrice(e.target.value)} />
          <label className="lg-label">특이사항 (선택) — 예: 클리커 포함, 위치</label>
          <input className="lg-input" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="간단히 메모" maxLength={100} />
        </div>
        {err && <p className="lg-err" style={{ marginTop: 10, fontSize: '.8rem' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="lg-btn-secondary" onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px', marginTop: 0 }} disabled={saving} onClick={save}>
            {saving ? '저장 중…' : '변경'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MachineRegisterModal({
  locations,
  onClose,
  onDone,
}: {
  locations: LocationRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [binCode, setBinCode] = useState('');
  const [slotCount, setSlotCount] = useState('6');
  const [defaultPrice, setDefaultPrice] = useState('5000');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!locationId) { setErr('매장을 선택해 주세요'); return; }
    if (!binCode.trim()) { setErr('머신 번호(코드)를 입력해 주세요'); return; }
    const cnt = Number(slotCount);
    if (!cnt || cnt < 1 || cnt > 20) { setErr('슬롯 수는 1~20 사이'); return; }
    setSaving(true); setErr('');
    try {
      await createGachaMachine(locationId, binCode.trim(), cnt, Number(defaultPrice));
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '90%', maxWidth: 380, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 14px', fontSize: '1.05rem' }}>머신 등록</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="lg-label">매장</label>
          <select className="lg-select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <label className="lg-label">머신 코드 (예: 삼청-2층-1번기)</label>
          <input className="lg-input" value={binCode} onChange={(e) => setBinCode(e.target.value)} placeholder="고유 식별 코드" />
          <label className="lg-label">슬롯 수</label>
          <input className="lg-input" type="number" min="1" max="20" value={slotCount} onChange={(e) => setSlotCount(e.target.value)} />
          <label className="lg-label">기본 판매가 (원)</label>
          <input className="lg-input" type="number" min="0" step="100" value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} />
        </div>
        {err && <p className="lg-err" style={{ marginTop: 10, fontSize: '.8rem' }}>{err}</p>}
        <p style={{ margin: '10px 0 0', fontSize: '.75rem', color: 'var(--lg-muted)' }}>
          슬롯은 빈 상태로 생성됩니다. 품목은 등록 후 슬롯별로 "품목변경"으로 설정하세요.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="lg-btn-secondary" onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px', marginTop: 0 }} disabled={saving} onClick={save}>
            {saving ? '등록 중…' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MachineEditModal({
  machine,
  locations,
  onClose,
  onDone,
}: {
  machine: GachaMachine;
  locations: LocationRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [locationId, setLocationId] = useState(machine.location_id);
  const [binCode, setBinCode] = useState(machine.bin_code);
  const [stockDate, setStockDate] = useState(machine.stock_as_of ? machine.stock_as_of.slice(0, 10) : '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const totalQty = machine.slots.reduce((s, sl) => s + sl.qty, 0);

  async function save() {
    if (!locationId) { setErr('매장을 선택해 주세요'); return; }
    if (!binCode.trim()) { setErr('머신 코드를 입력해 주세요'); return; }
    setSaving(true); setErr('');
    try {
      await updateGachaMachine(machine.bin_id, locationId, binCode.trim());
      const prevDate = machine.stock_as_of ? machine.stock_as_of.slice(0, 10) : '';
      if (stockDate !== prevDate) {
        await setGachaStockAsOf(machine.bin_id, stockDate ? new Date(stockDate + 'T12:00:00').toISOString() : null);
      }
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
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '90%', maxWidth: 380, boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 14px', fontSize: '1.05rem' }}>머신 수정 — {machine.bin_code}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="lg-label">매장</label>
          <select className="lg-select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <label className="lg-label">머신 코드</label>
          <input className="lg-input" value={binCode} onChange={(e) => setBinCode(e.target.value)} placeholder="고유 식별 코드" />
          <label className="lg-label">재고 확인 기준일 (보충하면 자동 갱신)</label>
          <input className="lg-input" type="date" value={stockDate} onChange={(e) => setStockDate(e.target.value)} />
        </div>
        {totalQty > 0 && (
          <p style={{ margin: '10px 0 0', fontSize: '.75rem', color: 'var(--lg-rust)' }}>
            ⚠️ 현재 머신에 재고 {totalQty}개가 있어요. 매장을 바꿔도 슬롯 재고는 그대로 따라갑니다.
          </p>
        )}
        {err && <p className="lg-err" style={{ marginTop: 10, fontSize: '.8rem' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="lg-btn-secondary" onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px', marginTop: 0 }} disabled={saving} onClick={save}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MachineCard({ machine, locations, onRefresh, onSaved, products, slotHistories }: {
  machine: GachaMachine;
  locations: LocationRow[];
  onRefresh: () => void;
  onSaved: (a: LastAction) => void;
  products: ProductRow[];
  slotHistories: Record<string, GachaSlotHistory[]>;
}) {
  const { session } = useRole();
  const [changeSlot, setChangeSlot] = useState<GachaSlot | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [refillActive, setRefillActive] = useState<Set<string>>(new Set());
  const [refillValues, setRefillValues] = useState<Record<string, string>>({});
  const [savingSlots, setSavingSlots] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [err, setErr] = useState('');

  const totalQty = machine.slots.reduce((s, sl) => s + sl.qty, 0);

  // 이 머신의 모든 슬롯 품목변경 이력 (최신순)
  const allHistory = machine.slots
    .flatMap((s) => (slotHistories[s.id] ?? []).map((h) => ({ ...h, slot_no: s.slot_no })))
    .sort((a, b) => new Date(b.applied_at).getTime() - new Date(a.applied_at).getTime());

  function toggleRefill(slotId: string) {
    setRefillActive((prev) => {
      const next = new Set(prev);
      next.has(slotId) ? next.delete(slotId) : next.add(slotId);
      return next;
    });
    setErr('');
  }

  async function saveRefill(slot: GachaSlot) {
    const refill = Number(refillValues[slot.id] || '0');
    if (!refill || refill <= 0) { setErr('보충 수량을 입력해 주세요'); return; }
    setSavingSlots((prev) => new Set(prev).add(slot.id));
    setErr('');
    try {
      // counted = slot.qty (현재 잔량 유지, 판매추정 0), 감모·실수금 없음
      await runGachaCheck(slot.id, slot.qty, refill, 0, null, null, session?.display_name ?? null);
      // 보충하면 이 머신의 재고 확인 시점을 자동 갱신 (A안)
      try { await setGachaStockAsOf(slot.bin_id, new Date().toISOString()); } catch { /* 시점 갱신 실패는 무시 */ }
      onSaved({ slot, prevQty: slot.qty });
      setRefillActive((prev) => { const n = new Set(prev); n.delete(slot.id); return n; });
      setRefillValues((prev) => { const n = { ...prev }; delete n[slot.id]; return n; });
      onRefresh();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSavingSlots((prev) => { const n = new Set(prev); n.delete(slot.id); return n; });
    }
  }

  // 마지막 보충/점검 되돌리기 (새로고침해도 동작 — gacha_check_undo RPC, 24시간 이내·이후 변경 없을 때만)
  async function undoRefill(slot: GachaSlot) {
    if (!confirm(`#${slot.slot_no} 슬롯의 마지막 보충을 취소할까요?\n(가장 최근 보충/점검 1건이 되돌려지고 재고가 복원됩니다)`)) return;
    setSavingSlots((prev) => new Set(prev).add(slot.id));
    setErr('');
    try {
      await undoGachaCheck(slot.id);
      onRefresh();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSavingSlots((prev) => { const n = new Set(prev); n.delete(slot.id); return n; });
    }
  }

  // 슬롯 회수 (위치이동용) — 잔량을 매장 재고로 되돌리고 슬롯을 비운다. 판매 아님.
  async function recoverSlot(slot: GachaSlot) {
    if (slot.qty <= 0) { setErr('회수할 잔량이 없어요'); return; }
    if (!confirm(`#${slot.slot_no} 슬롯의 잔량 ${slot.qty}개를 매장 재고로 회수할까요?\n(판매 아님 — 슬롯 위치이동용. 다른 슬롯에서 '보충'으로 옮기면 됩니다)`)) return;
    setSavingSlots((prev) => new Set(prev).add(slot.id));
    setErr('');
    try {
      await recoverGachaSlot(slot.id);
      onSaved({ slot, prevQty: slot.qty });
      onRefresh();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSavingSlots((prev) => { const n = new Set(prev); n.delete(slot.id); return n; });
    }
  }

  async function handleDelete() {
    const msg = totalQty > 0
      ? `'${machine.bin_code}' 머신을 삭제할까요?\n현재 재고 ${totalQty}개가 남아 있어요. 삭제하면 목록에서 사라집니다.`
      : `'${machine.bin_code}' 머신을 삭제할까요?`;
    if (!confirm(msg)) return;
    setDeleting(true); setErr('');
    try {
      await deleteGachaMachine(machine.bin_id);
      onRefresh();
    } catch (e: unknown) {
      setErr((e as Error).message);
      setDeleting(false);
    }
  }

  return (
    <div className="lg-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="lg-card-h" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>{machine.bin_code}</span>
        <span style={{ marginLeft: 'auto', fontSize: '.8rem', color: 'var(--lg-muted)' }}>총 {totalQty}개</span>
        <button className="lg-btn-secondary" style={{ padding: '4px 10px', fontSize: '.75rem', marginTop: 0, width: 'auto' }} onClick={() => setShowEdit(true)}>수정</button>
        <button className="lg-btn-secondary" style={{ padding: '4px 10px', fontSize: '.75rem', marginTop: 0, width: 'auto', color: 'var(--lg-rust)' }} disabled={deleting} onClick={handleDelete}>{deleting ? '삭제 중…' : '삭제'}</button>
      </div>
      <div style={{ padding: '6px 16px', fontSize: '.74rem', color: 'var(--lg-muted)', borderBottom: '1px solid var(--lg-line-soft)', background: 'var(--lg-bg)' }}>
        📅 재고 기준: {machine.stock_as_of
          ? new Date(machine.stock_as_of).toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : <span style={{ color: 'var(--lg-faint)' }}>미설정</span>}
      </div>
      {showEdit && (
        <MachineEditModal machine={machine} locations={locations} onClose={() => setShowEdit(false)} onDone={onRefresh} />
      )}

      {machine.slots.map((s) => (
        <div key={s.id} style={{ borderBottom: '1px solid var(--lg-line-soft)' }}>
          {/* 슬롯 헤더: 번호 + 품목명(두 줄) + 잔량 + 버튼 */}
          <div style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ flex: '0 0 28px', color: 'var(--lg-muted)', fontSize: '.78rem', fontWeight: 700, paddingTop: 2 }}>#{s.slot_no}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, fontSize: '.88rem', lineHeight: 1.3 }}>
                {s.product_name ?? <em style={{ color: 'var(--lg-faint)', fontWeight: 400 }}>미설정</em>}
              </div>
              {s.sku && (
                <div style={{ fontSize: '.74rem', color: 'var(--lg-muted)', marginTop: 2 }}>{s.sku}</div>
              )}
              {s.remark && (
                <div style={{ fontSize: '.72rem', color: 'var(--lg-hazel)', marginTop: 2 }}>📌 {s.remark}</div>
              )}
            </div>
            <div style={{ flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
              {s.price > 0 && <span style={{ fontSize: '.75rem', color: 'var(--lg-muted)' }}>{s.price.toLocaleString()}원</span>}
              <span
                style={{
                  fontSize: '.88rem', fontVariantNumeric: 'tabular-nums',
                  color: '#f97316',
                }}
              >
                총 보충수량 {s.qty}
              </span>
            </div>
          </div>
          {/* 액션 버튼 행 */}
          <div style={{ padding: '0 16px 10px', display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className={refillActive.has(s.id) ? 'lg-btn-main' : 'lg-btn-ghost'}
              style={{ padding: '4px 12px', fontSize: '.78rem', marginTop: 0, width: 'auto' }}
              onClick={() => toggleRefill(s.id)}
            >
              보충
            </button>
            <button className="lg-btn-ghost" style={{ padding: '4px 12px', fontSize: '.78rem' }} onClick={() => setChangeSlot(s)}>
              품목변경
            </button>
            {s.qty > 0 && (
              <button
                className="lg-btn-ghost"
                style={{ padding: '4px 12px', fontSize: '.78rem' }}
                disabled={savingSlots.has(s.id)}
                onClick={() => recoverSlot(s)}
                title="잔량을 매장 재고로 회수합니다 (판매 아님 — 슬롯 위치이동용)"
              >
                회수
              </button>
            )}
            <button
              className="lg-btn-ghost"
              style={{ padding: '4px 12px', fontSize: '.78rem', marginLeft: 'auto', color: 'var(--lg-rust)' }}
              disabled={savingSlots.has(s.id)}
              onClick={() => undoRefill(s)}
              title="이 슬롯의 마지막 보충을 취소합니다"
            >
              보충 취소
            </button>
          </div>
          {/* 보충 인라인 입력 */}
          {refillActive.has(s.id) && (
            <div style={{
              padding: '8px 16px 10px',
              background: 'var(--lg-surface)',
              borderTop: '1px solid var(--lg-line-soft)',
              display: 'flex', gap: 8, alignItems: 'center',
            }}>
              <input
                className="lg-input"
                type="number"
                min="1"
                placeholder="보충 수량"
                value={refillValues[s.id] || ''}
                onChange={(e) => setRefillValues((prev) => ({ ...prev, [s.id]: e.target.value }))}
                style={{ width: 110 }}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') saveRefill(s); if (e.key === 'Escape') toggleRefill(s.id); }}
              />
              <button
                className="lg-btn-main"
                style={{ width: 'auto', padding: '8px 16px', marginTop: 0 }}
                disabled={savingSlots.has(s.id)}
                onClick={() => saveRefill(s)}
              >
                {savingSlots.has(s.id) ? '저장 중…' : '저장'}
              </button>
              <button className="lg-btn-secondary" onClick={() => toggleRefill(s.id)}>취소</button>
            </div>
          )}
        </div>
      ))}

      {err && <p className="lg-err" style={{ padding: '4px 16px 8px', fontSize: '.8rem', margin: 0 }}>{err}</p>}

      {/* 품목변경 이력 */}
      {allHistory.length > 0 && (
        <div style={{ borderTop: '1px solid var(--lg-line-soft)' }}>
          <button
            className="lg-btn-ghost"
            style={{ width: '100%', padding: '8px 16px', fontSize: '.78rem', textAlign: 'left', borderRadius: 0 }}
            onClick={() => setHistoryOpen((o) => !o)}
          >
            품목변경 이력 {allHistory.length}건 {historyOpen ? '▲' : '▼'}
          </button>
          {historyOpen && (
            <div>
              {allHistory.map((h) => (
                <div key={h.id} style={{
                  display: 'flex', gap: 8, alignItems: 'center',
                  padding: '6px 16px', fontSize: '.78rem',
                  borderTop: '1px solid var(--lg-line-soft)',
                  background: 'var(--lg-surface)',
                }}>
                  <span style={{ flex: '0 0 28px', color: 'var(--lg-muted)', fontWeight: 700 }}>#{h.slot_no}</span>
                  <span style={{ flex: 1, fontWeight: 500 }}>{h.product_name ?? '—'}</span>
                  {h.sku && <span style={{ color: 'var(--lg-muted)', fontSize: '.72rem' }}>{h.sku}</span>}
                  {h.price != null && <span style={{ color: 'var(--lg-muted)' }}>{h.price.toLocaleString()}원</span>}
                  <span style={{ flex: '0 0 auto', color: 'var(--lg-muted)', fontSize: '.72rem' }}>
                    {new Date(h.applied_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {changeSlot && (
        <SlotChangeModal slot={changeSlot} products={products} onClose={() => setChangeSlot(null)} onDone={onRefresh} />
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
      {c.refill > 0 && <span style={{ color: 'var(--lg-sage)' }}>보충 +{c.refill}</span>}
      {c.sold_est > 0 && <span style={{ color: 'var(--lg-hazel)' }}>판매추정 {c.sold_est}개 / {c.revenue_est.toLocaleString()}원</span>}
      {c.shrinkage > 0 && (
        <span style={{ color: 'var(--lg-rust)', fontSize: '.75rem' }}>감모 {c.shrinkage} ({c.shrinkage_reason})</span>
      )}
      {c.checked_by_name && (
        <span style={{ color: 'var(--lg-muted)', fontSize: '.75rem' }}>— {c.checked_by_name}</span>
      )}
    </div>
  );
}

export function GachaScreen() {
  const [machines, setMachines] = useState<GachaMachine[]>([]);
  const [history, setHistory] = useState<GachaCheck[]>([]);
  const [revenueTotal, setRevenueTotal] = useState(0);
  const [slotHistories, setSlotHistories] = useState<Record<string, GachaSlotHistory[]>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [undoStack, setUndoStack] = useState<LastAction[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [selectedLoc, setSelectedLoc] = useState('');
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [showRegister, setShowRegister] = useState(false);

  function handleSaved(a: LastAction) {
    setUndoStack((s) => [...s, a]);
  }

  async function handleUndo() {
    if (undoStack.length === 0) return;
    const last = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    try {
      await undoGachaCheck(last.slot.id);
      setErr('');
      load();
    } catch (e: unknown) {
      setErr(`되돌리기 실패: ${(e as Error).message}`);
    }
  }

  function handleDownload() {
    const headers = ['머신번호', '슬롯', '품목코드', '품목명', '판매가', '총 보충수량'];
    const rows = machines.flatMap((m) =>
      m.slots.map((s) => [
        m.bin_code,
        s.slot_no,
        s.sku ?? '',
        s.product_name ?? '',
        s.price,
        s.qty,
      ]),
    );
    downloadCsv('가챠머신.csv', headers, rows);
  }

  function load() {
    Promise.all([getGachaMachines(selectedLoc || undefined), getGachaChecks(), getGachaRevenueTotal()])
      .then(([m, h, rev]) => {
        setMachines(m);
        setHistory(h);
        setRevenueTotal(rev);
        const allSlotIds = m.flatMap((machine) => machine.slots.map((s) => s.id));
        if (allSlotIds.length > 0) {
          getGachaSlotHistories(allSlotIds)
            .then(setSlotHistories)
            .catch(() => { /* 이력 조회 실패해도 메인 화면은 동작 */ });
        }
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [selectedLoc]);

  useEffect(() => {
    getLocations()
      .then((ls) => setLocations(ls.filter((l) => (l.type === 'store' || l.type === 'popup') && l.active)))
      .catch(() => { /* 매장 목록 실패해도 화면은 전체로 동작 */ });
    getAllProducts()
      .then(setProducts)
      .catch(() => { /* 품목 목록 실패해도 화면은 동작 */ });
  }, []);

  const totalSlots = machines.reduce((s, m) => s + m.slots.length, 0);
  const totalQty = machines.reduce((s, m) => s + m.slots.reduce((ss, sl) => ss + sl.qty, 0), 0);
  const totalRevenue = revenueTotal; // 전체 gacha_checks 합산 (히스토리 50건 제한과 무관한 정확한 누계)

  return (
    <div>
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="lg-sub" style={{ margin: 0 }}>머신 위치·번호·품목 — 보충과 품목변경을 관리</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <select
            className="lg-select"
            value={selectedLoc}
            onChange={(e) => setSelectedLoc(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="">전체 매장</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <button type="button" className="lg-btn-ghost" onClick={() => setShowRegister(true)}>
            + 머신 등록
          </button>
          {undoStack.length > 0 && (
            <button type="button" className="lg-btn-ghost" onClick={handleUndo}>
              마지막 작업 되돌리기
            </button>
          )}
          <button
            type="button"
            className="lg-btn-ghost"
            onClick={handleDownload}
            disabled={machines.length === 0}
            title="내보낼 데이터가 없습니다"
          >
            ⬇ 엑셀 다운로드
          </button>
        </div>
      </div>

      {err && <p className="lg-err">{err}</p>}

      <div className="lg-kpis" style={{ padding: 0 }}>
        <div className="lg-kpi">
          <div className="lg-kl">머신</div>
          <div className="lg-kv">{loading ? '…' : machines.length}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">슬롯</div>
          <div className="lg-kv">{loading ? '…' : totalSlots}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">총 보충수량 합</div>
          <div className="lg-kv">{loading ? '…' : totalQty}</div>
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
            <MachineCard key={m.bin_id} machine={m} locations={locations} onRefresh={load} onSaved={handleSaved} products={products} slotHistories={slotHistories} />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="lg-card" style={{ marginTop: 14 }}>
          <div className="lg-card-h" style={{ padding: '12px 16px', borderBottom: '1px solid var(--lg-line-soft)' }}>
            가챠 이력 <span className="lg-sub">최근 50건</span>
          </div>
          {history.map((c) => <HistoryRow key={c.id} c={c} />)}
        </div>
      )}

      {showRegister && (
        <MachineRegisterModal locations={locations} onClose={() => setShowRegister(false)} onDone={load} />
      )}

      <p className="lg-hint">
        보충은 매장 재고 → 머신 이동. 품목 변경 시 잔량은 매장으로 자동 회수됩니다.
      </p>
    </div>
  );
}
