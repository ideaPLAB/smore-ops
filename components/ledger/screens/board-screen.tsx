'use client';

import { useEffect, useRef, useState } from 'react';
import { useRole } from '../role-context';
import {
  getLocations,
  getSalesAsof,
  getOrderBoard,
  getCurrentRound,
  getOrderInputs,
  saveOrderInput,
  SupabaseMissingError,
  type OrderBoardRow,
  type OrderRound,
  type OrderInput,
} from '@/lib/ledger/queries';
import type { LocationRow } from '@/lib/ledger/types';

type ViewMode = 'action' | 'all';

function daysSinceAsof(asof: string | null): number | null {
  if (!asof) return null;
  const ms = Date.now() - new Date(asof).getTime();
  return Math.floor(ms / 86400000);
}

function rowClass(row: OrderBoardRow, inputVal: number | null, proposed: number): string {
  if (row.dead_stock_6m) return 'lg-br-dead';
  if (row.status === 'new') return 'lg-br-new';
  if (inputVal != null && proposed > 0 && Math.abs(inputVal - proposed) / proposed >= 0.3) return 'lg-br-dev';
  return '';
}

export function BoardScreen() {
  const { role } = useRole();

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationId] = useState('');
  const [asof, setAsof] = useState<string | null>(null);
  const [round, setRound] = useState<OrderRound | null>(null);
  const [board, setBoard] = useState<OrderBoardRow[]>([]);
  const [inputs, setInputs] = useState<Map<string, number | null>>(new Map());
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('action');
  const [searchQ, setSearchQ] = useState('');
  const [toast, setToast] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3000);
  }

  // 입력 맵 키: product_id + '|' + location_id
  function inputKey(row: OrderBoardRow) { return `${row.product_id}|${row.location_id}`; }

  async function loadData(locId?: string) {
    try {
      const [locs, asofDate, rnd] = await Promise.all([
        getLocations(),
        getSalesAsof(),
        getCurrentRound(),
      ]);
      const stores = locs.filter((l) => l.type === 'store' || l.type === 'popup');
      setLocations(locs);
      setAsof(asofDate);
      setRound(rnd);

      const targetLoc = locId ?? (stores[0]?.id ?? '');
      if (targetLoc && !locId) setLocationId(targetLoc);

      const [boardRows, oinputs] = await Promise.all([
        getOrderBoard(targetLoc || undefined),
        rnd ? getOrderInputs(rnd.id, targetLoc || undefined) : Promise.resolve([] as OrderInput[]),
      ]);
      setBoard(boardRows);

      const m = new Map<string, number | null>();
      oinputs.forEach((oi) => {
        m.set(`${oi.product_id}|${oi.location_id}`, oi.final_qty);
      });
      setInputs(m);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { loadData(); }, []);

  async function onLocationChange(id: string) {
    setLocationId(id);
    setStatus('loading');
    await loadData(id);
  }

  async function handleQtyChange(row: OrderBoardRow, val: string) {
    const key = inputKey(row);
    const qty = val === '' ? null : parseInt(val, 10);
    setInputs((prev) => new Map(prev).set(key, qty));

    if (!round) return;
    setSavingKey(key);
    try {
      await saveOrderInput(round.id, row.product_id, row.location_id, qty);
    } catch (e) {
      showToast(`저장 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setSavingKey(null);
    }
  }

  const storeLocations = locations.filter((l) => l.type === 'store' || l.type === 'popup');

  // 표시할 행 필터
  const filtered = board.filter((r) => {
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      if (!r.name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false;
    }
    if (viewMode === 'action') {
      // 조치 필요: 제안 > 0 이거나 미판매
      return r.proposed_qty > 0 || r.dead_stock_6m;
    }
    return true;
  });

  // KPI
  const inputCount = Array.from(inputs.values()).filter((v) => v != null).length;
  const totalAction = board.filter((r) => r.proposed_qty > 0 || r.dead_stock_6m).length;
  const devCount = filtered.filter((r) => {
    const v = inputs.get(inputKey(r));
    return v != null && r.proposed_qty > 0 && Math.abs(v - r.proposed_qty) / r.proposed_qty >= 0.3;
  }).length;
  const deadCount = board.filter((r) => r.dead_stock_6m).length;

  const asofDays = daysSinceAsof(asof);
  const salesStale = asofDays != null && asofDays > 7;

  const isHq = role === 'hq' || role === 'admin';

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">
            {round ? `${round.title} · 마감 ${round.due_at.slice(0, 10)}` : '열린 발주 라운드 없음'}
            {asof && <span style={{ marginLeft: 8, fontWeight: 600, color: salesStale ? 'var(--lg-rust)' : undefined }}>
              · 판매 기준 {asof}
            </span>}
          </p>
        </div>
      </div>

      {/* 판매 신선도 경고 배너 (§0-B-4) */}
      {salesStale && (
        <div className="lg-banner-warn">
          ⚠ 판매 데이터가 {asofDays}일 경과 — 제안수량 신뢰 불가.
          {isHq ? ' 판매 데이터 업로드 후 재확인하세요.' : ' 본사에 판매 데이터 업데이트를 요청하세요.'}
        </div>
      )}

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && (
        <div className="lg-card lg-empty">Supabase 환경 변수 없음 — <code>.env.local</code> 설정 필요</div>
      )}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          {/* KPI */}
          <div className="lg-kpis">
            <div className="lg-kpi"><div className="lg-kl">입력 진행</div><div className="lg-kv">{inputCount} / {totalAction}</div></div>
            <div className="lg-kpi"><div className="lg-kl">제안 대비 ±30% 이탈</div><div className="lg-kv lg-warn">{devCount}</div></div>
            <div className="lg-kpi"><div className="lg-kl">6개월 미판매</div><div className="lg-kv lg-bad">{deadCount}</div></div>
          </div>

          {/* 제안 공식 안내 */}
          <div className="lg-card" style={{ padding: '10px 16px', marginBottom: 12, fontSize: '.76rem', color: 'var(--lg-muted)', lineHeight: 1.7 }}>
            <b style={{ color: 'var(--lg-pine)' }}>제안수량</b> = 주판매 × (배송기간＋1주) ＋ 안전재고 − (매장재고＋이동중) 을 발주단위로 올림.
            신규 상품은 유사상품 기준 · 6개월 미판매/발주불가 상품은 제안 0으로 잠김.
          </div>

          {/* 툴바 */}
          <div className="lg-toolbar">
            <div className="lg-search">
              <input
                type="search"
                className="lg-input"
                placeholder="상품명 · SKU 검색"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            <select
              className="lg-select"
              value={locationId}
              onChange={(e) => onLocationChange(e.target.value)}
            >
              {storeLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <div className="lg-chip-toggle">
              <button type="button" className={viewMode === 'action' ? 'on' : ''} onClick={() => setViewMode('action')}>조치 필요만</button>
              <button type="button" className={viewMode === 'all' ? 'on' : ''} onClick={() => setViewMode('all')}>전체</button>
            </div>
          </div>

          {/* 발주 테이블 */}
          <div className="lg-card">
            <div className="lg-board-head">
              <span>상품명</span>
              <span className="lg-col-sku">SKU</span>
              <span className="lg-col-num lg-dim">재고</span>
              <span className="lg-col-num lg-dim">이동중</span>
              <span className="lg-col-num lg-dim">주판매</span>
              <span className="lg-col-num">제안</span>
              <span className="lg-col-input">최종수량</span>
            </div>

            {filtered.length === 0 && (
              <div className="lg-empty" style={{ padding: '20px 16px' }}>
                {viewMode === 'action' ? '조치 필요한 상품이 없습니다' : '상품 데이터가 없습니다'}
              </div>
            )}

            {filtered.map((row) => {
              const key = inputKey(row);
              const inputVal = inputs.get(key) ?? null;
              const isDead = row.dead_stock_6m;
              const cls = rowClass(row, inputVal, row.proposed_qty);
              const isSaving = savingKey === key;

              return (
                <div key={key} className={`lg-board-row ${cls}`}>
                  <span className="lg-board-name">
                    {row.name}
                    {row.status === 'new' && <span className="lg-tag-new">신규</span>}
                  </span>
                  <span className="lg-col-sku lg-mono lg-dim">{row.sku}</span>
                  <span className="lg-col-num lg-mono">{row.on_hand}</span>
                  <span className="lg-col-num lg-mono">{row.in_transit > 0 ? row.in_transit : '·'}</span>
                  <span className="lg-col-num lg-mono">{row.sales_7d}</span>
                  <span className="lg-col-num lg-mono" style={{ fontWeight: 700 }}>
                    {isDead ? <s className="lg-dim">0</s> : row.proposed_qty || '·'}
                  </span>
                  <span className="lg-col-input">
                    <input
                      type="number"
                      min="0"
                      step={row.order_unit}
                      className={`lg-qty-input${isSaving ? ' saving' : ''}`}
                      placeholder={isDead ? '잠김' : String(row.proposed_qty || '')}
                      disabled={isDead || !round}
                      value={inputVal ?? ''}
                      onChange={(e) => handleQtyChange(row, e.target.value)}
                    />
                  </span>
                </div>
              );
            })}
          </div>

          {/* 범례 */}
          <div className="lg-legend">
            <span><i className="lg-li-dev" /> 제안 대비 ±30% — 본사 확인</span>
            <span><i className="lg-li-dead" /> 6개월 미판매 — 발주 차단</span>
            <span><i className="lg-li-new" /> 신규 상품 — 유사상품 기준 적용</span>
          </div>

          {/* 본사 전용: 확정 버튼 */}
          {isHq && round && (
            <div className="lg-hq-bar">
              <button
                type="button"
                className="lg-btn-main"
                disabled={salesStale}
                title={salesStale ? '판매 데이터가 낡아 확정 불가' : ''}
              >
                입력 내용 최종 확인 →
              </button>
              {salesStale && (
                <span className="lg-dim" style={{ fontSize: '.78rem' }}>판매 데이터 낡음 — 신뢰 불가</span>
              )}
            </div>
          )}

          {!round && (
            <div className="lg-card lg-empty" style={{ marginTop: 12 }}>
              열린 발주 라운드가 없습니다. 본사에서 라운드를 개설해야 입력이 가능합니다.
            </div>
          )}
        </>
      )}

      {toast && <div className="lg-toast">{toast}</div>}
    </section>
  );
}
