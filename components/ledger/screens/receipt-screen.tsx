'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { getInboundOrders, receiveLine, getAllProducts, getLocations, manualReceive } from '@/lib/ledger/queries';
import { useRole } from '../role-context';
import type { InboundLine, InboundOrder } from '@/lib/ledger/queries';
import type { ProductRow, LocationRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

const DIFF_REASONS = ['수량 부족', '파손', '미발송', '이미 수령 완료', '기타'];
const NOORDER_SOURCES = ['전표 누락', '긴급 조달', '기타'];

function DiffRow({ line, onSaved }: { line: InboundLine; onSaved: () => void }) {
  const [qty, setQty] = useState<string>(line.qty_received != null ? String(line.qty_received) : String(line.qty_ordered));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(line.qty_received != null);
  const [err, setErr] = useState('');

  const needReason = Number(qty) < line.qty_ordered && !reason;

  async function save() {
    const n = Number(qty);
    if (isNaN(n) || n < 0) { setErr('유효한 수량을 입력하세요'); return; }
    if (needReason) { setErr('발주 수량보다 적으면 사유 필수'); return; }
    setSaving(true); setErr('');
    try {
      await receiveLine(line.id, n, line.qty_received);
      setSaved(true);
      onSaved();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lg-lg" style={{ flexWrap: 'wrap', gap: 8 }}>
      <span style={{ flex: '1 1 180px', minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{line.product_name}</span>
        <span style={{ color: 'var(--lg-muted)', fontSize: '.78rem', marginLeft: 6 }}>{line.sku}</span>
      </span>
      <span style={{ flex: '0 0 60px', textAlign: 'right', color: 'var(--lg-muted)', fontSize: '.82rem' }}>
        발주 {line.qty_ordered}
      </span>
      <input
        type="number"
        min="0"
        className="lg-qty-input"
        value={qty}
        disabled={saved}
        onChange={(e) => { setQty(e.target.value); setSaved(false); }}
        style={{ flex: '0 0 72px' }}
      />
      {Number(qty) < line.qty_ordered && !saved && (
        <select
          className="lg-select"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ flex: '1 1 140px', fontSize: '.82rem' }}
        >
          <option value="">사유 선택 *</option>
          {DIFF_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      {!saved ? (
        <button
          className="lg-btn-ghost"
          disabled={saving || needReason}
          onClick={save}
          style={{ flex: '0 0 auto' }}
        >
          {saving ? '저장 중…' : '확인'}
        </button>
      ) : (
        <span style={{ flex: '0 0 auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: 'var(--lg-pine)', fontSize: '.82rem', fontWeight: 700 }}>✓ 완료</span>
          <button
            className="lg-btn-ghost"
            onClick={() => setSaved(false)}
            style={{ fontSize: '.72rem', padding: '2px 8px' }}
          >수정</button>
        </span>
      )}
      {err && <span className="lg-err" style={{ flex: '1 0 100%', fontSize: '.78rem' }}>{err}</span>}
    </div>
  );
}

function OrderCard({ order, onRefresh, dimmed }: { order: InboundOrder; onRefresh: () => void; dimmed?: boolean }) {
  const [open, setOpen] = useState(false);
  const doneCount = order.lines.filter((l) => l.qty_received != null).length;
  const allDone = doneCount === order.lines.length;
  const aging = Math.floor((Date.now() - new Date(order.requested_at).getTime()) / 86400000);

  return (
    <div className="lg-vch" style={{ opacity: dimmed ? 0.7 : 1, background: dimmed ? '#f0f0ed' : undefined, borderLeft: dimmed ? '3px solid #ccc' : undefined }}>
      <button type="button" className="lg-vch-h" onClick={() => setOpen((v) => !v)}>
        <span className="lg-vch-no" style={{ color: dimmed ? 'var(--lg-muted)' : undefined }}>{order.order_no}</span>
        <span className="lg-vch-to">{order.from_location_name}</span>
        {aging > 7 && <span className="lg-aging over">{aging}일 경과</span>}
        {aging <= 7 && aging > 0 && <span className="lg-aging">{aging}일 경과</span>}
        <span style={{ color: allDone ? 'var(--lg-pine)' : 'var(--lg-muted)', fontSize: '.78rem', fontWeight: allDone ? 700 : undefined }}>
          {allDone ? '✓ 완료' : `${doneCount}/${order.lines.length} 확인`}
        </span>
        <span className="lg-vch-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="lg-vch-body">
          {order.lines.map((l) => (
            <DiffRow key={l.id} line={l} onSaved={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

// 수기 입고 등록 모달 — 전표 없이 도착한 물건을 바코드로 조회 → 매장 재고에 가산.
// 재고 반영은 manualReceive → manual_receive RPC (schema_patch_v0_10.sql).
function NoOrderModal({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const [stores, setStores] = useState<LocationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [bc, setBc] = useState('');
  const [found, setFound] = useState<ProductRow | null>(null);
  const [lookupMsg, setLookupMsg] = useState('');
  const [qty, setQty] = useState('1');
  const [source, setSource] = useState('');
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    getLocations()
      .then((ls) => {
        const s = ls.filter((l) => (l.type === 'store' || l.type === 'popup') && l.active);
        setStores(s);
        if (s[0]) setLocationId(s[0].id);
      })
      .catch(() => {});
    getAllProducts().then(setProducts).catch(() => {});
  }, []);

  function lookup() {
    const raw = bc.trim();
    if (!raw) { setFound(null); setLookupMsg('바코드를 입력하거나 스캔해 주세요'); return; }
    const p = products.find(
      (x) => x.barcode === raw || x.sku === raw || x.product_code === raw || x.name === raw,
    );
    if (!p) { setFound(null); setLookupMsg('✗ 등록되지 않은 바코드입니다 — 상품관리에서 먼저 등록해 주세요'); return; }
    setFound(p); setLookupMsg('');
  }

  async function save() {
    if (!found) { setErr('먼저 바코드로 상품을 조회해 주세요'); return; }
    const n = Math.round(Number(qty));
    if (!n || n < 1) { setErr('수량을 1 이상 입력해 주세요'); return; }
    if (!locationId) { setErr('매장을 선택해 주세요'); return; }
    setSaving(true); setErr('');
    try {
      const src = [source, name.trim() ? `담당 ${name.trim()}` : ''].filter(Boolean).join(' · ');
      await manualReceive({ productId: found.id, locationId, qty: n, note: memo || null, source: src || null });
      const store = stores.find((s) => s.id === locationId)?.name ?? '';
      onDone(`✅ ${found.name} ${n}개 → ${store} 입고 완료`);
      onClose();
    } catch (e) {
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
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '90%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>수기 입고 등록</h2>
        <p style={{ margin: '0 0 16px', color: 'var(--lg-muted)', fontSize: '.8rem' }}>
          전표 없이 도착한 물건(누락·긴급) — 바코드로 조회해 매장 재고에 가산합니다. 이력에 남습니다.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label className="lg-label">담당자명 (선택)</label>
              <input className="lg-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="입고 등록 담당자" style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="lg-label">매장</label>
              <select className="lg-select" value={locationId} onChange={(e) => setLocationId(e.target.value)} style={{ width: '100%' }}>
                {stores.length === 0 && <option value="">매장 없음</option>}
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <label className="lg-label">바코드 · 상품코드 · 상품명</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="lg-input"
              value={bc}
              onChange={(e) => setBc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') lookup(); }}
              placeholder="스캔하거나 입력 후 조회"
              style={{ flex: 1 }}
            />
            <button type="button" className="lg-btn-ghost" onClick={lookup}>상품 조회</button>
          </div>

          <div style={{ border: '1.5px dashed var(--lg-line)', borderRadius: 10, padding: '10px 14px', fontSize: '.82rem', color: found ? 'var(--lg-ink)' : 'var(--lg-faint)' }}>
            {found ? (
              <>
                <strong>{found.name}</strong>
                <div style={{ color: 'var(--lg-muted)', fontSize: '.76rem', marginTop: 2 }}>
                  {found.sku}{found.barcode ? ` · ${found.barcode}` : ''}{found.vendor_name ? ` · ${found.vendor_name}` : ''}
                </div>
              </>
            ) : (
              <span style={{ color: lookupMsg.startsWith('✗') ? 'var(--lg-rust)' : 'var(--lg-faint)' }}>
                {lookupMsg || '조회된 상품이 아직 없습니다.'}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: '0 0 110px' }}>
              <label className="lg-label">수량</label>
              <input className="lg-input" type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="lg-label">출처 (선택)</label>
              <select className="lg-select" value={source} onChange={(e) => setSource(e.target.value)} style={{ width: '100%' }}>
                <option value="">선택 안 함</option>
                {NOORDER_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <label className="lg-label">메모 (선택)</label>
          <input className="lg-input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 전표 미수신, 업체 직접 전달" />
        </div>

        {err && <p className="lg-err" style={{ marginTop: 10, fontSize: '.8rem' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="lg-btn-ghost" onClick={onClose}>취소</button>
          <button type="button" className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving || !found} onClick={save}>
            {saving ? '등록 중…' : '입고 등록'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ReceiptScreen() {
  const { role } = useRole();
  const isHq = role === 'hq' || role === 'admin';
  const [orders, setOrders] = useState<InboundOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showNoOrder, setShowNoOrder] = useState(false);
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filterStore, setFilterStore] = useState('');
  const [filterVendor, setFilterVendor] = useState('');
  const version = useRef(0);

  const storeOptions = useMemo(() => [...new Set(orders.map((o) => o.to_location_name).filter((n) => n && n !== '—'))].sort(), [orders]);
  const vendorOptions = useMemo(() => {
    const vendors = orders.map((o) => {
      const m = o.from_location_name.match(/업체 직납 · (.+)/);
      return m ? m[1] : null;
    }).filter(Boolean) as string[];
    return [...new Set(vendors)].sort();
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (filterStore) list = list.filter((o) => o.to_location_name === filterStore);
    if (filterVendor) list = list.filter((o) => o.from_location_name.includes(filterVendor));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((o) =>
        o.order_no.toLowerCase().includes(q) ||
        o.from_location_name.toLowerCase().includes(q) ||
        o.to_location_name.toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, search, filterStore, filterVendor]);

  function load() {
    const v = ++version.current;
    getInboundOrders()
      .then((data) => { if (v === version.current) setOrders(data); })
      .catch((e) => setErr(e.message))
      .finally(() => { if (v === version.current) setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  function handleDownload() {
    const headers = ['전표번호', '유형', '도착지', '품목코드', '품목명', '발주', '검수', '검수시각'];
    const rows: unknown[][] = [];
    for (const o of orders) {
      for (const l of o.lines) {
        rows.push([
          o.order_no,
          o.status,
          o.from_location_name,
          l.sku,
          l.product_name,
          l.qty_ordered,
          l.qty_received ?? '',
          l.received_at ?? '',
        ]);
      }
    }
    downloadCsv('입고검수.csv', headers, rows);
  }

  return (
    <div>
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <p className="lg-sub">우리 매장에 도착하는 전표 — 펼쳐서 업체별로 확인</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button type="button" className="lg-btn-ghost" onClick={() => setShowNoOrder(true)}>
            수기 입고 등록
          </button>
          <button
            type="button"
            className="lg-btn-ghost"
            onClick={handleDownload}
            disabled={orders.length === 0}
            title={orders.length === 0 ? '내보낼 데이터가 없습니다' : undefined}
          >⬇ 엑셀 다운로드</button>
        </div>
      </div>

      {notice && (
        <div className="lg-card" style={{ background: '#E8F5E9', border: '1px solid #A5D6A7', marginBottom: 12, padding: '10px 14px', fontSize: '.83rem' }}>
          {notice}
        </div>
      )}

      {err && <p className="lg-err">{err}</p>}

      {isHq && !loading && orders.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <input
            className="lg-input"
            style={{ flex: '1 1 180px', minWidth: 120 }}
            placeholder="전표번호 · 업체명 · 매장명 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select className="lg-select" style={{ flex: '0 0 130px' }} value={filterStore} onChange={(e) => setFilterStore(e.target.value)}>
            <option value="">전체 매장</option>
            {storeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {vendorOptions.length > 0 && (
            <select className="lg-select" style={{ flex: '0 0 130px' }} value={filterVendor} onChange={(e) => setFilterVendor(e.target.value)}>
              <option value="">전체 업체</option>
              {vendorOptions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {(search || filterStore || filterVendor) && (
            <button className="lg-btn-ghost" style={{ fontSize: '.78rem' }} onClick={() => { setSearch(''); setFilterStore(''); setFilterVendor(''); }}>초기화</button>
          )}
        </div>
      )}

      {loading ? (
        <p className="lg-empty">불러오는 중…</p>
      ) : filtered.length === 0 ? (
        <div className="lg-card lg-empty">{orders.length === 0 ? '도착 대기 중인 전표 없음' : '검색 결과 없음'}</div>
      ) : (() => {
        const pending = filtered.filter((o) => o.lines.some((l) => l.qty_received == null));
        const done = filtered.filter((o) => o.lines.every((l) => l.qty_received != null));
        return (
          <div>
            {pending.length > 0 && (
              <>
                <p style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--lg-muted)', margin: '0 0 6px' }}>확인 대기</p>
                {pending.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} />)}
              </>
            )}
            {done.length > 0 && (
              <>
                <p style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--lg-muted)', margin: '16px 0 6px' }}>완료 — 수정하려면 전표 열고 [수정] 클릭</p>
                {done.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} dimmed />)}
              </>
            )}
          </div>
        );
      })()}

      <p className="lg-hint">수량을 발주보다 적게 넣으면 차이 사유 선택이 필수입니다. · 전표 없이 온 물건은 [수기 입고 등록]으로 바코드 조회 후 등록.</p>

      {showNoOrder && (
        <NoOrderModal
          onClose={() => setShowNoOrder(false)}
          onDone={(msg) => { setNotice(msg); load(); }}
        />
      )}
    </div>
  );
}
