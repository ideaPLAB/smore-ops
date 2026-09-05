'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getLocations,
  getProducts,
  createTransferOrder,
  getStoreTransferOrders,
  shipLine,
  receiveLine,
  SupabaseMissingError,
  type DispatchLine,
  type StoreTransferOrder,
} from '@/lib/ledger/queries';
import type { LocationRow, ProductRow } from '@/lib/ledger/types';

type Tab = 'request' | 'outbound' | 'inbound';

function fmtDate(iso: string) {
  return iso.slice(0, 10).replace(/-/g, '/');
}

function statusLabel(s: string) {
  if (s === 'requested') return '이동 요청';
  if (s === 'partially_received') return '일부 수령';
  if (s === 'received') return '수령 완료';
  return s;
}

function statusColor(s: string): string {
  if (s === 'received') return 'var(--lg-ok, #16a34a)';
  if (s === 'partially_received') return 'var(--lg-warn, #d97706)';
  return 'var(--lg-muted)';
}

// ── 출고 확인 라인 ─────────────────────────────────────────────────────────────
function ShipRow({ line, onDone }: { line: StoreTransferOrder['lines'][number]; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const done = line.qty_shipped != null;

  async function doShip() {
    setSaving(true); setErr('');
    try {
      await shipLine(line.id, line.qty_ordered);
      onDone();
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="lg-board-row">
      <span className="lg-board-name">{line.product_name}</span>
      <span className="lg-col-sku lg-mono lg-dim">{line.sku}</span>
      <span className="lg-col-num lg-mono">{line.qty_ordered}</span>
      <span className="lg-col-num">
        {done
          ? <span className="lg-tag">✓ 출고됨 ({line.qty_shipped})</span>
          : <button type="button" className="lg-btn-sm" disabled={saving} onClick={doShip}>
              {saving ? '…' : '출고 확인'}
            </button>}
      </span>
      {err && <span className="lg-err" style={{ fontSize: '.72rem' }}>{err}</span>}
    </div>
  );
}

// ── 수령 확인 라인 ─────────────────────────────────────────────────────────────
function ReceiveRow({ line, onDone }: { line: StoreTransferOrder['lines'][number]; onDone: () => void }) {
  const [qty, setQty] = useState(String(line.qty_ordered));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const done = line.qty_received != null;

  async function doReceive() {
    const n = Number(qty);
    if (isNaN(n) || n < 0) { setErr('유효한 수량 입력'); return; }
    setSaving(true); setErr('');
    try {
      await receiveLine(line.id, n, line.qty_received);
      onDone();
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  const diff = Number(qty) - line.qty_ordered;

  return (
    <div className="lg-board-row">
      <span className="lg-board-name">{line.product_name}</span>
      <span className="lg-col-sku lg-mono lg-dim">{line.sku}</span>
      <span className="lg-col-num lg-mono">{line.qty_ordered}</span>
      <span className="lg-col-num">
        {done
          ? <>
              <span className={`lg-tag${diff !== 0 ? ' lg-tag-dev' : ''}`}>
                {diff !== 0 ? `조정 ${diff > 0 ? '+' : ''}${diff}` : '✓ 수령 완료'}
              </span>
            </>
          : <>
              <input
                type="number" min="0"
                className="lg-qty-input"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                style={{ width: 64 }}
              />
              <button type="button" className="lg-btn-sm" disabled={saving} onClick={doReceive} style={{ marginLeft: 4 }}>
                {saving ? '…' : '수령 확인'}
              </button>
            </>}
      </span>
      {err && <span className="lg-err" style={{ fontSize: '.72rem' }}>{err}</span>}
    </div>
  );
}

// ── 이동 전표 카드 ─────────────────────────────────────────────────────────────
function TransferCard({
  order,
  mode,
  onRefresh,
}: {
  order: StoreTransferOrder;
  mode: 'outbound' | 'inbound';
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`lg-vch${open ? ' open' : ''}`}>
      <button type="button" className="lg-vch-h" onClick={() => setOpen((v) => !v)}>
        <span className="lg-vch-no">{order.order_no}</span>
        <span className="lg-vch-to">
          {order.from_location_name} → {order.to_location_name}
        </span>
        <span className="lg-dim" style={{ fontSize: '.75rem' }}>{fmtDate(order.requested_at)}</span>
        <span className="lg-badge" style={{ color: statusColor(order.status) }}>
          {statusLabel(order.status)}
        </span>
        <span className="lg-vch-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="lg-vch-body">
          <div className="lg-lg lg-lhead">
            <span>상품명</span>
            <span className="lg-col-sku">상품코드</span>
            <span className="lg-col-num">요청</span>
            <span className="lg-col-num">
              {mode === 'outbound' ? '출고 확인' : '수령 확인'}
            </span>
          </div>
          {order.lines.map((l) =>
            mode === 'outbound'
              ? <ShipRow key={l.id} line={l} onDone={onRefresh} />
              : <ReceiveRow key={l.id} line={l} onDone={onRefresh} />,
          )}
        </div>
      )}
    </div>
  );
}

// ── 메인 화면 ─────────────────────────────────────────────────────────────────
export function StoreTransferScreen() {
  const [tab, setTab] = useState<Tab>('request');
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [orders, setOrders] = useState<StoreTransferOrder[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  // 이동 요청 폼
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [searchQty, setSearchQty] = useState('');
  const [lines, setLines] = useState<DispatchLine[]>([]);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }

  async function loadData() {
    try {
      const [locs, prods, ords] = await Promise.all([
        getLocations(),
        getProducts(),
        getStoreTransferOrders(),
      ]);
      const stores = locs.filter((l) => l.type === 'store' || l.type === 'popup');
      setLocations(locs);
      setProducts(prods);
      setOrders(ords);
      if (stores.length > 0) {
        setFromLocationId(stores[0].id);
        setToLocationId(stores.length > 1 ? stores[1].id : stores[0].id);
      }
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { loadData(); }, []);

  const storeLocations = locations.filter((l) => l.type === 'store' || l.type === 'popup');

  // 상품 검색
  const filtered = searchQ.trim()
    ? products.filter(
        (p) =>
          p.name.toLowerCase().includes(searchQ.toLowerCase()) ||
          p.sku.toLowerCase().includes(searchQ.toLowerCase()) ||
          (p.barcode ?? '').includes(searchQ),
      ).slice(0, 8)
    : [];

  function addLine(product: ProductRow) {
    const qty = parseInt(searchQty, 10);
    if (!qty || qty < 1) { showToast('수량을 입력해 주세요'); return; }
    setLines((prev) => {
      const idx = prev.findIndex((l) => l.product_id === product.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + qty };
        return next;
      }
      return [...prev, { product_id: product.id, product_name: product.name, sku: product.sku, qty }];
    });
    setSearchQ('');
    setSearchQty('');
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function sendRequest() {
    if (!lines.length) { showToast('담긴 상품이 없어요'); return; }
    if (!fromLocationId) { showToast('출발 매장을 선택해 주세요'); return; }
    if (!toLocationId) { showToast('도착 매장을 선택해 주세요'); return; }
    if (fromLocationId === toLocationId) { showToast('출발과 도착 매장이 같아요'); return; }
    setSending(true);
    try {
      const orderNo = await createTransferOrder(toLocationId, fromLocationId, lines);
      setLines([]);
      showToast(`이동 요청 ${orderNo} 생성 완료`);
      const ords = await getStoreTransferOrders();
      setOrders(ords);
    } catch (e) {
      showToast(`오류: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setSending(false);
    }
  }

  async function refresh() {
    try {
      const ords = await getStoreTransferOrders();
      setOrders(ords);
    } catch {
      // 조용히 무시
    }
  }

  // 탭별 전표 필터
  const outboundOrders = orders.filter(
    (o) => o.status !== 'received' &&
      storeLocations.some((l) => l.id === (o as unknown as { from_location_id: string }).from_location_id)
  );
  const inboundOrders = orders.filter(
    (o) => o.status !== 'received' &&
      storeLocations.some((l) => l.id === (o as unknown as { to_location_id: string }).to_location_id)
  );

  // 실제로는 admin이 전체 보기, 매니저는 본인 매장만. 일단 전체 표시.
  const outbound = orders.filter((o) => o.status !== 'received');
  const inbound = orders.filter((o) => o.status !== 'received');

  if (status === 'loading') return <div className="lg-spinner">로딩 중…</div>;
  if (status === 'noenv') return <div className="lg-empty">Supabase 환경 변수가 없어요. .env.local을 확인해 주세요.</div>;
  if (status === 'error') return <div className="lg-empty lg-err">오류: {errMsg}</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 탭 */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--lg-line)', paddingBottom: 0 }}>
        {(['request', 'outbound', 'inbound'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px',
              fontSize: '.83rem',
              fontWeight: tab === t ? 700 : 400,
              borderBottom: tab === t ? '2px solid var(--lg-ink)' : '2px solid transparent',
              background: 'transparent',
              color: tab === t ? 'var(--lg-ink)' : 'var(--lg-muted)',
              cursor: 'pointer',
            }}
          >
            {t === 'request' ? '이동 요청' : t === 'outbound' ? '출고 대기' : '수령 대기'}
          </button>
        ))}
      </div>

      {/* 이동 요청 생성 탭 */}
      {tab === 'request' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 매장 선택 */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ fontSize: '.83rem', fontWeight: 600, minWidth: 60 }}>출발 매장</label>
            <select
              className="lg-select"
              value={fromLocationId}
              onChange={(e) => setFromLocationId(e.target.value)}
            >
              {storeLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
            <span style={{ color: 'var(--lg-muted)', fontSize: '.9rem' }}>→</span>
            <label style={{ fontSize: '.83rem', fontWeight: 600, minWidth: 60 }}>도착 매장</label>
            <select
              className="lg-select"
              value={toLocationId}
              onChange={(e) => setToLocationId(e.target.value)}
            >
              {storeLocations.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>

          {/* 상품 검색 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="lg-search"
              type="text"
              placeholder="상품명 / SKU / 바코드 검색"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
            />
            <input
              className="lg-qty-input"
              type="number"
              min="1"
              placeholder="수량"
              value={searchQty}
              onChange={(e) => setSearchQty(e.target.value)}
              style={{ width: 72 }}
            />
          </div>
          {filtered.length > 0 && (
            <div className="lg-suggest">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="lg-suggest-item"
                  onClick={() => addLine(p)}
                >
                  <span>{p.name}</span>
                  <span className="lg-dim lg-mono" style={{ fontSize: '.75rem' }}>{p.sku}</span>
                </button>
              ))}
            </div>
          )}

          {/* 담긴 상품 */}
          {lines.length > 0 && (
            <div className="lg-vch open">
              <div className="lg-vch-body">
                <div className="lg-lg lg-lhead">
                  <span>상품명</span>
                  <span className="lg-col-sku">코드</span>
                  <span className="lg-col-num">수량</span>
                  <span className="lg-col-num" />
                </div>
                {lines.map((l, i) => (
                  <div key={l.product_id} className="lg-lg">
                    <span>{l.product_name}</span>
                    <span className="lg-col-sku lg-mono lg-dim">{l.sku}</span>
                    <span className="lg-col-num lg-mono">{l.qty}</span>
                    <span className="lg-col-num">
                      <button type="button" className="lg-btn-sm" onClick={() => removeLine(i)}>
                        삭제
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            type="button"
            className="lg-btn"
            disabled={sending || lines.length === 0}
            onClick={sendRequest}
            style={{ alignSelf: 'flex-start' }}
          >
            {sending ? '처리 중…' : `이동 요청 전송 (${lines.length}종)`}
          </button>
        </div>
      )}

      {/* 출고 대기 탭 */}
      {tab === 'outbound' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="lg-dim" style={{ fontSize: '.8rem' }}>
            이 매장에서 다른 매장으로 보내야 하는 이동 요청 — 출고 확인 후 상대 매장이 수령 처리합니다.
          </p>
          {outbound.length === 0
            ? <div className="lg-empty">출고 대기 중인 이동 요청이 없어요</div>
            : outbound.map((o) => (
                <TransferCard key={o.id} order={o} mode="outbound" onRefresh={refresh} />
              ))}
        </div>
      )}

      {/* 수령 대기 탭 */}
      {tab === 'inbound' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p className="lg-dim" style={{ fontSize: '.8rem' }}>
            이 매장으로 오는 이동 요청 — 물건 받으면 수량 확인 후 수령 처리하세요.
          </p>
          {inbound.length === 0
            ? <div className="lg-empty">수령 대기 중인 이동 요청이 없어요</div>
            : inbound.map((o) => (
                <TransferCard key={o.id} order={o} mode="inbound" onRefresh={refresh} />
              ))}
        </div>
      )}

      {toast && (
        <div
          style={{
            position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
            background: 'var(--lg-ink)', color: 'var(--lg-bg)', padding: '10px 20px',
            borderRadius: 8, fontSize: '.85rem', zIndex: 999,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
