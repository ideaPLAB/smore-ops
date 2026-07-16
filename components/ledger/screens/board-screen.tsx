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
  previewRoundSplit,
  confirmRoundOrders,
  getConfirmation,
  cancelConfirmation,
  SupabaseMissingError,
  type OrderBoardRow,
  type OrderRound,
  type OrderInput,
  type SplitLine,
  type RoundConfirmation,
} from '@/lib/ledger/queries';
import type { LocationRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

type ViewMode = 'action' | 'all';

// v_order_board 는 vendor_name 을 항상 노출하진 않는다 — 있으면 쓰고 없으면 '미지정'.
function vendorOf(row: OrderBoardRow): string {
  const v = (row as OrderBoardRow & { vendor_name?: string | null }).vendor_name;
  return v && v.trim() ? v : '미지정 업체';
}

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

// 최종 확인 모달 — 창고분/업체분 분할을 보여주고 확정한다.
function ConfirmReviewModal({
  roundId, locationId, locationName, onClose, onConfirmed,
}: {
  roundId: string;
  locationId: string;
  locationName: string;
  onClose: () => void;
  onConfirmed: (msg: string) => void;
}) {
  const [lines, setLines] = useState<SplitLine[] | null>(null);
  const [err, setErr] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    previewRoundSplit(roundId, locationId)
      .then(setLines)
      .catch((e) => setErr((e as Error).message));
  }, [roundId, locationId]);

  const whLines = (lines ?? []).filter((l) => l.warehouse_qty > 0);
  const vendorLines = (lines ?? []).filter((l) => l.vendor_qty > 0);

  // 업체분 업체별 그룹
  const vendorGroups: [string, SplitLine[]][] = (() => {
    const m = new Map<string, SplitLine[]>();
    for (const l of vendorLines) {
      const arr = m.get(l.vendor);
      if (arr) arr.push(l); else m.set(l.vendor, [l]);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  })();

  async function doConfirm() {
    setConfirming(true); setErr('');
    try {
      const res = await confirmRoundOrders(roundId, locationId);
      onConfirmed(`✅ 발주 확정 — 전표 ${res.order_nos.length}건 생성 (창고분 ${res.warehouse_items} · 업체분 ${res.vendor_items}품목, 총 ${res.total_qty}개)`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  const empty = lines != null && whLines.length === 0 && vendorLines.length === 0;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>{locationName} · 발주 최종 확인</h2>
        <p style={{ margin: '0 0 16px', color: 'var(--lg-muted)', fontSize: '.8rem' }}>
          창고에서 갈 것과 업체에 발주할 것이 자동으로 나뉩니다. 확정하면 전표가 생성됩니다.
        </p>

        {err && <p className="lg-err" style={{ fontSize: '.82rem' }}>{err}</p>}
        {lines == null && !err && <p className="lg-empty">계산 중…</p>}
        {empty && <div className="lg-card lg-empty">확정할 최종수량이 없습니다.</div>}

        {whLines.length > 0 && (
          <>
            <div className="lg-vch-h" style={{ margin: '4px 0', fontSize: '.8rem', fontWeight: 700 }}>
              창고 출고분 → 출고요청 전표 · {whLines.length}품목
            </div>
            {whLines.map((l) => (
              <div key={`w-${l.sku}`} style={{ display: 'flex', gap: 10, padding: '6px 10px', fontSize: '.82rem', borderBottom: '1px solid var(--lg-line-soft)' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '.74rem', color: 'var(--lg-muted)', flex: '0 0 90px' }}>{l.sku}</span>
                <span style={{ flex: 1 }}>{l.name}</span>
                <span style={{ fontWeight: 700, flex: '0 0 auto' }}>{l.warehouse_qty}개</span>
              </div>
            ))}
          </>
        )}

        {vendorGroups.length > 0 && (
          <>
            <div className="lg-vch-h" style={{ margin: '14px 0 4px', fontSize: '.8rem', fontWeight: 700, color: 'var(--lg-hazel)' }}>
              업체 발주분 → 업체별 구매발주 전표 · {vendorLines.length}품목
            </div>
            {vendorGroups.map(([vendor, ls]) => (
              <div key={`v-${vendor}`}>
                <div style={{ padding: '6px 10px 2px', fontSize: '.74rem', fontWeight: 700, color: 'var(--lg-muted)' }}>{vendor}</div>
                {ls.map((l) => (
                  <div key={`v-${l.sku}`} style={{ display: 'flex', gap: 10, padding: '6px 10px', fontSize: '.82rem', borderBottom: '1px solid var(--lg-line-soft)' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '.74rem', color: 'var(--lg-muted)', flex: '0 0 90px' }}>{l.sku}</span>
                    <span style={{ flex: 1 }}>{l.name}</span>
                    <span style={{ fontWeight: 700, flex: '0 0 auto' }}>{l.vendor_qty}개</span>
                    <span style={{ color: 'var(--lg-faint)', fontSize: '.72rem', flex: '0 0 auto' }}>창고 부족분</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="lg-btn-ghost" onClick={onClose} disabled={confirming}>취소</button>
          <button type="button" className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={confirming || empty || lines == null} onClick={doConfirm}>
            {confirming ? '전표 생성 중…' : '발주 확정 · 전표 생성'}
          </button>
        </div>
      </div>
    </div>
  );
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
  const [showDetail, setShowDetail] = useState(false);
  const [groupByVendor, setGroupByVendor] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [toast, setToast] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<RoundConfirmation | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [cancelling, setCancelling] = useState(false);

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

      // 이 매장×라운드의 활성 확정 조회
      if (rnd && targetLoc) {
        try { setConfirmation(await getConfirmation(rnd.id, targetLoc)); }
        catch { setConfirmation(null); }
      } else {
        setConfirmation(null);
      }
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

  // 최종수량: 사용자가 입력한 값이 있으면 그 값, 없으면 제안수량
  function finalQtyOf(row: OrderBoardRow): number {
    const v = inputs.get(inputKey(row));
    return v != null ? v : row.proposed_qty;
  }

  function handleDownload() {
    const headers = ['품목코드', '품목명', '업체', '발주단위', '재고', '이동중', '주판매', '제안', '최종수량', '발주가능'];
    const rows = filtered.map((r) => [
      r.sku,
      r.name,
      vendorOf(r),
      r.order_unit,
      r.on_hand,
      r.in_transit,
      r.sales_7d,
      r.dead_stock_6m ? 0 : r.proposed_qty,
      r.dead_stock_6m ? 0 : finalQtyOf(r),
      r.dead_stock_6m ? '불가' : '가능',
    ]);
    downloadCsv('발주판.csv', headers, rows);
  }

  // 이카운트 업로드용 파일 — 확정 스냅샷 기준
  function handleDownloadRound() {
    if (!confirmation) return;
    const store = storeLocations.find((l) => l.id === confirmation.location_id)?.name ?? '';
    const headers = ['품목코드', '품목명', '업체', '매장', '수량', '창고분', '업체분'];
    const rows = confirmation.snapshot
      .slice()
      .sort((a, b) => String(a.vendor).localeCompare(String(b.vendor), 'ko'))
      .map((it) => [it.sku, it.name, it.vendor, store, it.qty, it.warehouse_qty, it.vendor_qty]);
    downloadCsv(`이카운트업로드_발주_${store}.csv`, headers, rows);
  }

  async function handleCancelConfirm() {
    if (!confirmation) return;
    if (!window.confirm('발주 확정을 취소하고 전표를 회수할까요? (출고·입고가 시작된 전표가 있으면 취소되지 않습니다)')) return;
    setCancelling(true);
    try {
      await cancelConfirmation(confirmation.id);
      showToast('확정이 취소됐어요 — 전표 회수, 창고재고 복원 완료');
      await loadData(locationId);
    } catch (e) {
      showToast(`취소 실패: ${(e as Error).message}`);
    } finally {
      setCancelling(false);
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

  // 업체별 묶기: filtered 를 업체명으로 그룹핑 (표시 순서는 업체명 정렬)
  const vendorGroups: [string, OrderBoardRow[]][] = (() => {
    const m = new Map<string, OrderBoardRow[]>();
    for (const r of filtered) {
      const v = vendorOf(r);
      const arr = m.get(v);
      if (arr) arr.push(r);
      else m.set(v, [r]);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  })();

  // 한 행 렌더 — 평면 목록과 업체별 묶기에서 공용으로 쓴다.
  function renderRow(row: OrderBoardRow) {
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
        {showDetail && <span className="lg-dim" style={{ flex: '0 0 110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '.78rem' }}>{vendorOf(row)}</span>}
        {showDetail && <span className="lg-col-num lg-mono lg-dim">{row.order_unit}</span>}
        <span className="lg-col-num lg-mono">{row.on_hand}</span>
        <span className="lg-col-num lg-mono">{row.in_transit > 0 ? row.in_transit : '·'}</span>
        <span className="lg-col-num lg-mono">{row.sales_7d}</span>
        {showDetail && <span className="lg-col-num lg-mono lg-dim">{row.sales_30d}</span>}
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
  }

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
            <b style={{ color: 'var(--lg-ink)' }}>제안수량</b> = 주판매 × (배송기간＋1주) ＋ 안전재고 − (매장재고＋이동중) 을 발주단위로 올림.
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
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
              <button type="button" className="lg-btn-ghost" onClick={() => setShowDetail((v) => !v)}>
                {showDetail ? '상세 열 접기' : '상세 열 펼치기'}
              </button>
              <button type="button" className="lg-btn-ghost" onClick={() => setGroupByVendor((v) => !v)}>
                {groupByVendor ? '목록 보기' : '업체별 묶기'}
              </button>
              <button
                type="button"
                className="lg-btn-ghost"
                onClick={handleDownload}
                disabled={filtered.length === 0}
                title={filtered.length === 0 ? '내보낼 데이터가 없습니다' : undefined}
              >⬇ 엑셀 다운로드</button>
            </div>
          </div>

          {/* 발주 테이블 */}
          <div className="lg-card">
            <div className="lg-board-head">
              <span>상품명</span>
              <span className="lg-col-sku">SKU</span>
              {showDetail && <span className="lg-dim" style={{ flex: '0 0 110px' }}>업체</span>}
              {showDetail && <span className="lg-col-num lg-dim">단위</span>}
              <span className="lg-col-num lg-dim">재고</span>
              <span className="lg-col-num lg-dim">이동중</span>
              <span className="lg-col-num lg-dim">주판매</span>
              {showDetail && <span className="lg-col-num lg-dim">30일</span>}
              <span className="lg-col-num">제안</span>
              <span className="lg-col-input">최종수량</span>
            </div>

            {filtered.length === 0 && (
              <div className="lg-empty" style={{ padding: '20px 16px' }}>
                {viewMode === 'action' ? '조치 필요한 상품이 없습니다' : '상품 데이터가 없습니다'}
              </div>
            )}

            {groupByVendor
              ? vendorGroups.map(([vendor, rows]) => (
                  <div key={vendor}>
                    <div className="lg-board-row" style={{ background: 'var(--lg-surface)', fontWeight: 700, fontSize: '.78rem', color: 'var(--lg-muted)' }}>
                      {vendor} · {rows.length}건
                    </div>
                    {rows.map((row) => renderRow(row))}
                  </div>
                ))
              : filtered.map((row) => renderRow(row))}
          </div>

          {/* 범례 */}
          <div className="lg-legend">
            <span><i className="lg-li-dev" /> 제안 대비 ±30% — 본사 확인</span>
            <span><i className="lg-li-dead" /> 6개월 미판매 — 발주 차단</span>
            <span><i className="lg-li-new" /> 신규 상품 — 유사상품 기준 적용</span>
          </div>

          {/* 본사 전용: 확정 흐름 */}
          {isHq && round && !confirmation && (
            <div className="lg-hq-bar">
              <button
                type="button"
                className="lg-btn-main"
                disabled={salesStale}
                title={salesStale ? '판매 데이터가 낡아 확정 불가' : ''}
                onClick={() => setShowReview(true)}
              >
                입력 내용 최종 확인 →
              </button>
              {salesStale && (
                <span className="lg-dim" style={{ fontSize: '.78rem' }}>판매 데이터 낡음 — 신뢰 불가</span>
              )}
            </div>
          )}

          {/* 확정 완료 박스 */}
          {isHq && round && confirmation && (
            <div className="lg-card" style={{ marginTop: 12, background: '#E8F5E9', border: '1px solid #A5D6A7', padding: '14px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 6 }}>
                ✓ {round.title} 발주 확정 완료
              </div>
              <div style={{ fontSize: '.8rem', color: 'var(--lg-muted)', marginBottom: 12 }}>
                {storeLocations.find((l) => l.id === confirmation.location_id)?.name} · {confirmation.snapshot.length}품목 · 전표 {confirmation.order_nos.join(', ') || '없음'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="lg-btn-main" style={{ width: 'auto', padding: '9px 16px' }} onClick={handleDownloadRound}>
                  이카운트 업로드용 파일 다운로드
                </button>
                <button type="button" className="lg-btn-ghost" disabled={cancelling} onClick={handleCancelConfirm}>
                  {cancelling ? '취소 중…' : '확정 취소 (전표 회수)'}
                </button>
              </div>
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

      {showReview && round && (
        <ConfirmReviewModal
          roundId={round.id}
          locationId={locationId}
          locationName={storeLocations.find((l) => l.id === locationId)?.name ?? ''}
          onClose={() => setShowReview(false)}
          onConfirmed={(msg) => { showToast(msg); loadData(locationId); }}
        />
      )}
    </section>
  );
}
