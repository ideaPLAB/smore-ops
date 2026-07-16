'use client';

import { useEffect, useRef, useState } from 'react';
import {
  getLocations,
  getProducts,
  createTransferOrder,
  getRecentDispatchOrders,
  SupabaseMissingError,
  type DispatchLine,
  type DispatchOrder,
} from '@/lib/ledger/queries';
import type { LocationRow, ProductRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

function statusLabel(s: string) {
  if (s === 'requested') return '이동중';
  if (s === 'partially_received') return '일부검수';
  if (s === 'received') return '완료';
  return s;
}

function fmtDate(iso: string) {
  return iso.slice(0, 10).replace(/-/g, '/');
}

function HistoryCard({ order }: { order: DispatchOrder }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lg-vch${open ? ' open' : ''}`}>
      <button type="button" className="lg-vch-h" onClick={() => setOpen((v) => !v)}>
        <span className="lg-vch-no">{order.order_no}</span>
        <span className="lg-vch-to">→ {order.to_location_name}</span>
        <span className="lg-dim" style={{ fontSize: '.75rem' }}>{fmtDate(order.requested_at)}</span>
        <span className="lg-badge">{statusLabel(order.status)}</span>
        <span className="lg-vch-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="lg-vch-body">
          <div className="lg-lg lg-lhead">
            <span>상품명</span>
            <span className="lg-col-sku">상품코드</span>
            <span className="lg-col-nums">발주 / 출고 / 검수</span>
          </div>
          {order.lines.map((l, i) => (
            <div className="lg-lg" key={`${l.sku}-${i}`}>
              <span>{l.product_name}</span>
              <span className="lg-col-sku lg-mono lg-dim">{l.sku}</span>
              <span className="lg-col-nums">
                <span className="lg-nums">
                  <b className="lg-num">{l.qty_ordered}</b>
                  {' / '}
                  <b className="lg-num">{l.qty_shipped ?? '·'}</b>
                  {' / '}
                  <b className="lg-num">{l.qty_received ?? '·'}</b>
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DispatchScreen() {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [history, setHistory] = useState<DispatchOrder[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  // 출고요청 폼 상태
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
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }

  async function loadData() {
    try {
      const [locs, prods, hist] = await Promise.all([
        getLocations(),
        getProducts(),
        getRecentDispatchOrders(),
      ]);
      const stores = locs.filter((l) => l.type === 'store' || l.type === 'popup');
      setLocations(locs);
      setProducts(prods);
      setHistory(hist);
      if (stores.length > 0) setToLocationId(stores[0].id);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { loadData(); }, []);

  // 상품 검색 — 이름 또는 SKU 포함
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
      const existing = prev.findIndex((l) => l.product_id === product.id);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], qty: next[existing].qty + qty };
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

  async function sendDispatch() {
    if (!lines.length) { showToast('담긴 상품이 없어요'); return; }
    if (!toLocationId) { showToast('받는 매장을 선택해 주세요'); return; }

    const warehouse = locations.find((l) => l.type === 'warehouse');
    if (!warehouse) { showToast('창고 위치 정보를 찾을 수 없어요'); return; }

    setSending(true);
    try {
      const orderNo = await createTransferOrder(toLocationId, warehouse.id, lines);
      setLines([]);
      showToast(`출고요청 ${orderNo} 전송 완료 — 이동중 기록 시작`);
      // 이력 갱신
      const hist = await getRecentDispatchOrders();
      setHistory(hist);
    } catch (e) {
      showToast(`오류: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setSending(false);
    }
  }

  function handleDownload() {
    // 보낸 출고요청 전표/라인을 한 줄씩 CSV로 내보내기
    const headers = ['전표번호', '유형', '도착지', '요청일', '품목코드', '품목명', '발주', '출고', '검수'];
    const rows = history.flatMap((o) =>
      o.lines.map((l) => [
        o.order_no,
        statusLabel(o.status),
        o.to_location_name,
        fmtDate(o.requested_at),
        l.sku,
        l.product_name,
        l.qty_ordered,
        l.qty_shipped ?? '',
        l.qty_received ?? '',
      ]),
    );
    downloadCsv('출고요청.csv', headers, rows);
  }

  const storeLocations = locations.filter((l) => l.type === 'store' || l.type === 'popup');

  return (
    <section className="lg-screen">
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <p className="lg-sub">물류사에 보내는 출고예정전표 — 보내는 순간 이동중 기록 시작</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button
            type="button"
            className="lg-btn-ghost"
            onClick={handleDownload}
            disabled={history.length === 0}
            title={history.length === 0 ? '내보낼 데이터가 없습니다' : undefined}
          >⬇ 엑셀 다운로드</button>
        </div>
      </div>

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && (
        <div className="lg-card lg-empty">Supabase 환경 변수가 없어. <code>.env.local</code>에 URL·anon key를 넣으면 실데이터가 떠.</div>
      )}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          {/* 출고요청 폼 */}
          <div className="lg-form-card">
            <div className="lg-form-toprow">
              <button
                type="button"
                className="lg-btn-ghost"
                disabled
                title="발주판 구현 후 연동 예정"
              >
                발주판 수량 불러오기
              </button>
            </div>

            <div className="lg-f-row">
              {/* 받는 매장 */}
              <div className="lg-f-col">
                <label className="lg-label" htmlFor="d-store">받는 매장</label>
                <select
                  id="d-store"
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
              <div className="lg-f-col lg-f-grow">
                <label className="lg-label" htmlFor="d-prod">상품 검색</label>
                <input
                  id="d-prod"
                  className="lg-input"
                  placeholder="이름 · SKU · 바코드"
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  autoComplete="off"
                />
                {filtered.length > 0 && (
                  <div className="lg-autocomplete">
                    {filtered.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="lg-ac-item"
                        onClick={() => { setSearchQ(`${p.name} (${p.sku})`); }}
                      >
                        <span>{p.name}</span>
                        <span className="lg-mono lg-dim">{p.sku}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 수량 */}
              <div className="lg-f-col" style={{ flex: '0 0 90px' }}>
                <label className="lg-label" htmlFor="d-qty">수량</label>
                <input
                  id="d-qty"
                  type="number"
                  min="1"
                  className="lg-input"
                  placeholder="0"
                  value={searchQty}
                  onChange={(e) => setSearchQty(e.target.value)}
                />
              </div>

              {/* 담기 */}
              <div className="lg-f-col" style={{ flex: '0 0 auto', alignSelf: 'flex-end' }}>
                <button
                  type="button"
                  className="lg-btn-ghost"
                  onClick={() => {
                    const match = products.find(
                      (p) =>
                        searchQ.includes(p.sku) ||
                        searchQ === p.name ||
                        searchQ === `${p.name} (${p.sku})`,
                    );
                    if (!match) { showToast('상품을 목록에서 선택해 주세요'); return; }
                    addLine(match);
                  }}
                >
                  담기
                </button>
              </div>
            </div>

            {/* 담긴 품목 목록 */}
            <div className="lg-line-list">
              {lines.length === 0 ? (
                <div className="lg-empty">발주판에서 불러오거나 위에서 검색해 담아 주세요</div>
              ) : (
                lines.map((l, i) => (
                  <div key={l.product_id} className="lg-line-item">
                    <span>
                      {l.product_name} <span className="lg-mono lg-dim">{l.sku}</span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <b className="lg-num">{l.qty}개</b>
                      <button
                        type="button"
                        className="lg-x"
                        aria-label="빼기"
                        onClick={() => removeLine(i)}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>

            <button
              type="button"
              className="lg-btn-main"
              onClick={sendDispatch}
              disabled={sending || lines.length === 0}
            >
              {sending ? '전송 중…' : '출고요청 보내기'}
            </button>
            <p className="lg-hint">창고 재고가 모자란 품목은 본사 구매 담당에게 별도 발주 요청 필요합니다.</p>
          </div>

          {/* 이력 */}
          <div className="lg-card" style={{ marginTop: 18 }}>
            <div className="lg-card-h">
              보낸 출고요청
              <span className="lg-sub">전표 클릭 시 펼침</span>
            </div>
            {history.length === 0 ? (
              <div className="lg-empty" style={{ padding: '18px 16px' }}>아직 보낸 출고요청이 없습니다</div>
            ) : (
              history.map((o) => <HistoryCard key={o.id} order={o} />)
            )}
          </div>
        </>
      )}

      {/* 토스트 */}
      {toast && (
        <div className="lg-toast">{toast}</div>
      )}
    </section>
  );
}
