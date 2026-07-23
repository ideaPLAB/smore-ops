'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getGachaMachines, getGachaChecks, runGachaCheck, undoGachaCheck, getLocations, getProducts, changeGachaSlot, createGachaMachine } from '@/lib/ledger/queries';
import type { GachaMachine, GachaSlot, GachaCheck } from '@/lib/ledger/queries';
import type { LocationRow, ProductRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

// 방금 저장한 점검의 스냅샷 — undo(직전 작업 되돌리기) 스택용.
// 서버 반영(gacha_check RPC)은 되돌리는 역RPC가 없어서, 되돌리기는 "직전 슬롯을 원래 잔량으로 되돌리는 교정 점검 화면"을 다시 여는 방식으로만 안전하게 처리한다.
interface LastAction {
  slot: GachaSlot;
  prevQty: number; // 점검 직전 슬롯 잔량 (교정 시 되돌릴 값)
}

const SHRINKAGE_REASONS = ['뽑기 오류', '분실', '파손', '기타'];

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
      }).slice(0, 30)
    : products.slice(0, 30);

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

const BTN_CANCEL: CSSProperties = {
  width: 'auto', padding: '10px 20px', marginTop: 0,
  background: 'var(--lg-surface)', color: 'var(--lg-ink)',
  border: '1px solid var(--lg-line)',
};

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
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    if (!productId) { setErr('품목을 선택해 주세요'); return; }
    const p = Number(price);
    if (isNaN(p) || p < 0) { setErr('판매가를 확인해 주세요'); return; }
    setSaving(true); setErr('');
    try {
      await changeGachaSlot(slot.id, productId, p);
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
            ⚠ 잔량 {slot.qty}개가 매장 재고로 자동 회수됩니다
          </p>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="lg-label">품목 검색</label>
          <ProductSearch products={products} value={productId} onChange={setProductId} />
          <label className="lg-label">판매가 (원)</label>
          <input className="lg-input" type="number" min="0" step="100" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        {err && <p className="lg-err" style={{ marginTop: 10, fontSize: '.8rem' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="lg-btn-main" style={BTN_CANCEL} onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving} onClick={save}>
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
          <button className="lg-btn-main" style={BTN_CANCEL} onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving} onClick={save}>
            {saving ? '등록 중…' : '등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CheckModal({
  slot,
  onClose,
  onDone,
  onSaved,
  initialCounted,
}: {
  slot: GachaSlot;
  onClose: () => void;
  onDone: () => void;
  onSaved?: (a: LastAction) => void;
  initialCounted?: string;
}) {
  const [counted, setCounted] = useState(initialCounted ?? '');
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
      // 점검 직전 잔량(slot.qty)을 스냅샷으로 남겨 되돌리기 스택에 쌓는다.
      onSaved?.({ slot, prevQty: slot.qty });
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
          <button className="lg-btn-main" style={BTN_CANCEL} onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving} onClick={save}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

function MachineCard({ machine, onRefresh, onSaved, products }: { machine: GachaMachine; onRefresh: () => void; onSaved: (a: LastAction) => void; products: ProductRow[] }) {
  const [checkSlot, setCheckSlot] = useState<GachaSlot | null>(null);
  const [changeSlot, setChangeSlot] = useState<GachaSlot | null>(null);
  const lowCount = machine.slots.filter((s) => s.qty < 10).length;
  const totalQty = machine.slots.reduce((s, sl) => s + sl.qty, 0);

  return (
    <div className="lg-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="lg-card-h" style={{ padding: '12px 16px' }}>
        <span>{machine.bin_code}</span>
        {lowCount > 0 && (
          <span className="lg-badge" style={{ background: 'var(--lg-rust-soft)', color: 'var(--lg-rust)' }}>
            잔량 부족 {lowCount}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: '.8rem', color: 'var(--lg-muted)' }}>총 {totalQty}개</span>
      </div>
      {machine.slots.map((s) => (
        <div key={s.id} className="lg-lg" style={{ padding: '8px 16px' }}>
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
          <button className="lg-btn-ghost" style={{ flex: '0 0 auto', padding: '4px 10px', fontSize: '.78rem' }} onClick={() => setChangeSlot(s)}>
            품목변경
          </button>
          <button className="lg-btn-ghost" style={{ flex: '0 0 auto', padding: '4px 10px', fontSize: '.78rem' }} onClick={() => setCheckSlot(s)}>
            점검
          </button>
        </div>
      ))}
      {checkSlot && (
        <CheckModal slot={checkSlot} onClose={() => setCheckSlot(null)} onDone={onRefresh} onSaved={onSaved} />
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
  const [undoStack, setUndoStack] = useState<LastAction[]>([]);
  const [correctSlot, setCorrectSlot] = useState<GachaSlot | null>(null);
  const [correctInit, setCorrectInit] = useState('');
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
    // 서버 롤백 RPC(gacha_check_undo, v0_14): 판매추정/감모/보충 역방향 이벤트 기록
    // + 슬롯 잔량 복원 + 점검 이력 삭제. 가드(이후 점검·품목변경·잔량 변동·24h)에
    // 걸려 거부되면 기존 방식대로 교정 점검 화면으로 폴백한다.
    try {
      await undoGachaCheck(last.slot.id);
      setErr('');
      load();
    } catch (e: unknown) {
      setErr(`되돌리기 실패: ${(e as Error).message} — 교정 점검으로 전환합니다`);
      setCorrectInit(String(last.prevQty));
      setCorrectSlot(last.slot);
    }
  }

  function handleDownload() {
    // 화면이 보여주는 가챠머신/슬롯을 CSV로 내보낸다.
    const headers = ['머신번호', '슬롯', '품목코드', '품목명', '판매가', '잔량'];
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
    Promise.all([getGachaMachines(selectedLoc || undefined), getGachaChecks()])
      .then(([m, h]) => { setMachines(m); setHistory(h); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [selectedLoc]);

  useEffect(() => {
    getLocations()
      .then((ls) => setLocations(ls.filter((l) => (l.type === 'store' || l.type === 'popup') && l.active)))
      .catch(() => { /* 매장 목록 실패해도 화면은 전체로 동작 */ });
    getProducts()
      .then(setProducts)
      .catch(() => { /* 품목 목록 실패해도 화면은 동작 */ });
  }, []);

  const totalSlots = machines.reduce((s, m) => s + m.slots.length, 0);
  const totalQty = machines.reduce((s, m) => s + m.slots.reduce((ss, sl) => ss + sl.qty, 0), 0);
  const lowSlots = machines.reduce((s, m) => s + m.slots.filter((sl) => sl.qty < 10).length, 0);
  const totalRevenue = history.reduce((s, c) => s + c.revenue_est, 0);

  return (
    <div>
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="lg-sub" style={{ margin: 0 }}>머신 위치·번호·품목 — 보충과 점검을 기록</p>
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
            <MachineCard key={m.bin_id} machine={m} onRefresh={load} onSaved={handleSaved} products={products} />
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

      {correctSlot && (
        <CheckModal
          slot={correctSlot}
          initialCounted={correctInit}
          onClose={() => setCorrectSlot(null)}
          onDone={load}
          onSaved={handleSaved}
        />
      )}

      <p className="lg-hint">
        판매추정 = 직전 잔량 − 실사 잔량. 보충은 매장 재고 → 머신 이동, 품목 변경 시 잔량은 매장으로 회수됩니다.
      </p>
    </div>
  );
}
