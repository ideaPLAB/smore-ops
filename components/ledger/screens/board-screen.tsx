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
  resetOrderInputs,
  previewRoundSplit,
  confirmRoundOrders,
  getConfirmation,
  cancelConfirmation,
  getConfirmationVouchers,
  cancelConfirmationOrder,
  updateVoucherLine,
  SupabaseMissingError,
  type OrderBoardRow,
  type OrderRound,
  type OrderInput,
  type SplitLine,
  type RoundConfirmation,
  type ConfirmationVoucher,
} from '@/lib/ledger/queries';
import type { LocationRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

type ViewMode = 'action' | 'all';

function vendorOf(row: OrderBoardRow): string {
  return row.vendor_name && row.vendor_name.trim() ? row.vendor_name : '미지정 업체';
}

// 상품명 아래 서브라인: 상품코드 · 공급구분 (품목코드/바코드/업체명은 별도 컬럼)
function subLine(row: OrderBoardRow): string {
  return [row.alt_code ? `상품 ${row.alt_code}` : '', row.supply_type ?? '']
    .filter(Boolean)
    .join(' · ');
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
                <div style={{ padding: '6px 10px 2px' }}>
                  <span className="lg-vendor-pill" style={{ fontSize: '.7rem', padding: '2px 10px' }}>{vendor}</span>
                </div>
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

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end', alignItems: 'center' }}>
          <button type="button" className="lg-btn-ghost" style={{ padding: '10px 20px', fontSize: '.9rem' }} onClick={onClose} disabled={confirming}>취소</button>
          <button type="button" className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px', marginTop: 0 }} disabled={confirming || empty || lines == null} onClick={doConfirm}>
            {confirming ? '전표 생성 중…' : '발주 확정 · 전표 생성'}
          </button>
        </div>
      </div>
    </div>
  );
}

// 전표 수정 모달 — 라인 수량 수정(0 = 품목 제외), 저장 시 변경분만 RPC 호출
function VoucherEditModal({
  confirmationId, voucher, onClose, onChanged,
}: {
  confirmationId: string;
  voucher: ConfirmationVoucher;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [qtys, setQtys] = useState<Map<string, string>>(
    () => new Map(voucher.lines.map((l) => [l.product_id, String(l.qty_ordered)])),
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const changed = voucher.lines.filter((l) => {
    if (l.qty_shipped != null || l.qty_received != null) return false;
    const v = qtys.get(l.product_id);
    if (v == null || v === '') return false;
    const n = parseInt(v, 10);
    return !Number.isNaN(n) && n >= 0 && n !== l.qty_ordered;
  });

  async function save() {
    setSaving(true); setErr('');
    try {
      for (const l of changed) {
        const n = parseInt(qtys.get(l.product_id) ?? '', 10);
        await updateVoucherLine(confirmationId, voucher.order_no, l.product_id, n);
      }
      onChanged(`✅ 전표 ${voucher.order_no} 수정 완료 — ${changed.length}품목 반영`);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,.18)' }}>
        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>
          전표 수정 · <span className="lg-mono">{voucher.order_no}</span>
        </h2>
        <p style={{ margin: '0 0 16px', color: 'var(--lg-muted)', fontSize: '.8rem' }}>
          {voucher.is_vendor ? `업체 구매발주 · ${voucher.vendor_name ?? '미지정 업체'}` : '창고 출고요청'} —
          {' '}0으로 저장하면 품목이 전표에서 제외됩니다.
          {!voucher.is_vendor && ' 수량 변경분은 창고재고에 자동 반영됩니다.'}
        </p>

        {err && <p className="lg-err" style={{ fontSize: '.82rem' }}>{err}</p>}

        {voucher.lines.map((l) => {
          const started = l.qty_shipped != null || l.qty_received != null;
          return (
            <div key={l.product_id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 4px', fontSize: '.84rem', borderBottom: '1px solid var(--lg-line-soft)' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '.74rem', color: 'var(--lg-muted)', flex: '0 0 90px' }}>{l.sku}</span>
              <span style={{ flex: 1 }}>{l.name}</span>
              {started && <span style={{ fontSize: '.7rem', color: 'var(--lg-rust)', flex: '0 0 auto' }}>출고·입고 진행 — 수정 불가</span>}
              <input
                type="number"
                min="0"
                className="lg-qty-input"
                style={{ width: 80, flex: '0 0 auto' }}
                disabled={started || saving}
                value={qtys.get(l.product_id) ?? ''}
                onChange={(e) => setQtys((prev) => new Map(prev).set(l.product_id, e.target.value))}
              />
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 8, marginTop: 20, justifyContent: 'flex-end' }}>
          <button type="button" className="lg-btn-ghost" onClick={onClose} disabled={saving}>닫기</button>
          <button type="button" className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px' }} disabled={saving || changed.length === 0} onClick={save}>
            {saving ? '저장 중…' : `변경 저장 (${changed.length}품목)`}
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
  const [vouchers, setVouchers] = useState<ConfirmationVoucher[]>([]);
  const [editVoucher, setEditVoucher] = useState<ConfirmationVoucher | null>(null);
  const [cancellingNo, setCancellingNo] = useState<string | null>(null);
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

      // 이 매장×라운드의 활성 확정 조회 (+ 전표별 수정/취소용 전표 목록)
      if (rnd && targetLoc) {
        try {
          const conf = await getConfirmation(rnd.id, targetLoc);
          setConfirmation(conf);
          setVouchers(conf ? await getConfirmationVouchers(conf.order_nos) : []);
        } catch { setConfirmation(null); setVouchers([]); }
      } else {
        setConfirmation(null);
        setVouchers([]);
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
    // 화면 컬럼 순서와 동일하게: 품목코드 > 상품명 > 바코드 > 업체명 > 단위 > 재고 > 이동중 > 주판매 > 30일 > 제안 > 최종수량
    const headers = ['품목코드', '상품명', '바코드', '업체명', '단위', '재고', '이동중', '주판매', '30일', '제안', '최종수량', '상품코드', '공급구분', '발주가능'];
    const rows = filtered.map((r) => [
      r.sku,
      r.name,
      r.barcode ?? '',
      vendorOf(r),
      r.order_unit,
      r.on_hand,
      r.in_transit,
      r.sales_7d,
      r.sales_30d,
      r.dead_stock_6m ? 0 : r.proposed_qty,
      r.dead_stock_6m ? 0 : finalQtyOf(r),
      r.alt_code ?? '',
      r.supply_type ?? '',
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
    if (!window.confirm('발주 확정 전체를 취소하고 전표를 모두 회수할까요? (출고·입고가 시작된 전표가 있으면 취소되지 않습니다)')) return;
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

  // 입력수량 리셋 — 현재 매장×라운드의 최종수량을 전부 비움 (확정 취소는 입력을 복원하므로 별도 버튼)
  const [resetting, setResetting] = useState(false);
  async function handleResetInputs() {
    if (!round || !locationId) return;
    const locName = locations.find((l) => l.id === locationId)?.name ?? '이 매장';
    if (!window.confirm(`${locName}의 입력한 최종수량을 전부 비울까요? (제안수량은 유지됩니다)`)) return;
    setResetting(true);
    try {
      const n = await resetOrderInputs(round.id, locationId);
      setInputs(new Map());
      showToast(`입력수량 ${n}건 리셋 완료`);
    } catch (e) {
      showToast(`리셋 실패: ${(e as Error).message}`);
    } finally {
      setResetting(false);
    }
  }

  // 전표 1건만 취소 — 창고분은 창고재고 자동 복원
  async function handleCancelOrder(orderNo: string) {
    if (!confirmation) return;
    if (!window.confirm(`전표 ${orderNo}만 취소할까요? (창고분은 창고재고가 자동 복원됩니다)`)) return;
    setCancellingNo(orderNo);
    try {
      await cancelConfirmationOrder(confirmation.id, orderNo);
      showToast(`전표 ${orderNo} 취소 완료`);
      await loadData(locationId);
    } catch (e) {
      showToast(`취소 실패: ${(e as Error).message}`);
    } finally {
      setCancellingNo(null);
    }
  }

  const storeLocations = locations.filter((l) => l.type === 'store' || l.type === 'popup');

  // 표시할 행 필터 — 상품명 · SKU · 업체명 · 바코드 검색
  const filtered = board.filter((r) => {
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      const hit = r.name.toLowerCase().includes(q)
        || r.sku.toLowerCase().includes(q)
        || vendorOf(r).toLowerCase().includes(q)
        || (r.barcode ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (viewMode === 'action') {
      // 조치 필요: 제안 > 0 이거나 미판매
      return r.proposed_qty > 0 || r.dead_stock_6m;
    }
    return true;
  });

  // KPI — 입력 진행은 조치 필요 행 기준으로만 센다 (라운드에 남은 옛 입력값이 끼면 4/0처럼 보이는 문제 방지)
  const actionRows = board.filter((r) => r.proposed_qty > 0 || r.dead_stock_6m);
  const totalAction = actionRows.length;
  const inputCount = actionRows.filter((r) => inputs.get(inputKey(r)) != null).length;
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

    const sub = subLine(row);

    return (
      <div key={key} className={`lg-board-row ${cls}`}>
        <span className="lg-bc-sku lg-mono lg-dim">{row.sku}</span>
        <span className="lg-board-name" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {row.name}
            {row.status === 'new' && <span className="lg-tag-new">신규</span>}
          </span>
          {sub && (
            <span className="lg-dim" style={{ fontSize: '.68rem', lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {sub}
            </span>
          )}
        </span>
        <span className="lg-bc-bar lg-mono lg-dim">{row.barcode ?? '·'}</span>
        <span className="lg-bc-vendor lg-dim" title={vendorOf(row)}>{vendorOf(row)}</span>
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
          {/* 확정 완료 박스 — 전표별 수정/취소 포함 */}
          {isHq && round && confirmation && (
            <div className="lg-card" style={{ marginBottom: 12, background: '#E8F5E9', border: '1px solid #A5D6A7', padding: '14px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: '.9rem', marginBottom: 6 }}>
                ✓ {round.title} 발주 확정 완료
              </div>
              <div style={{ fontSize: '.8rem', color: 'var(--lg-muted)', marginBottom: 10 }}>
                {storeLocations.find((l) => l.id === confirmation.location_id)?.name} · {confirmation.snapshot.length}품목 · 전표 {confirmation.order_nos.length}건
              </div>

              {/* 전표별 행: 수정 · 전표 취소 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                {vouchers.map((v) => {
                  const started = v.lines.some((l) => l.qty_shipped != null || l.qty_received != null);
                  return (
                    <div key={v.order_no} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'white', border: '1px solid var(--lg-line-soft)', borderRadius: 10, padding: '8px 12px', flexWrap: 'wrap' }}>
                      <span className="lg-mono" style={{ fontWeight: 700, fontSize: '.8rem' }}>{v.order_no}</span>
                      <span style={{ fontSize: '.76rem', color: 'var(--lg-muted)' }}>
                        {v.is_vendor ? `업체분 · ${v.vendor_name ?? '미지정 업체'}` : '창고분 · 출고요청'} · {v.lines.length}품목
                      </span>
                      {started && <span style={{ fontSize: '.72rem', color: 'var(--lg-rust)' }}>출고·입고 진행 중</span>}
                      <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                        <button type="button" className="lg-btn-ghost" style={{ height: 32, padding: '0 12px', fontSize: '.8rem' }} disabled={started} onClick={() => setEditVoucher(v)}>
                          수정
                        </button>
                        <button type="button" className="lg-btn-ghost" style={{ height: 32, padding: '0 12px', fontSize: '.8rem' }} disabled={started || cancellingNo === v.order_no} onClick={() => handleCancelOrder(v.order_no)}>
                          {cancellingNo === v.order_no ? '취소 중…' : '전표 취소'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" className="lg-btn-main" style={{ width: 'auto', height: 40, padding: '0 16px', marginTop: 0 }} onClick={handleDownloadRound}>
                  이카운트 업로드용 파일 다운로드
                </button>
                <button type="button" className="lg-btn-ghost" style={{ height: 40, padding: '0 16px', fontSize: '.9rem' }} disabled={cancelling} onClick={handleCancelConfirm}>
                  {cancelling ? '취소 중…' : '전체 확정 취소 (전표 회수)'}
                </button>
              </div>
            </div>
          )}

          {/* 본사 전용: 확정 흐름 — 상단 배치 */}
          {isHq && round && !confirmation && (
            <div className="lg-hq-bar" style={{ marginBottom: 12 }}>
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
                placeholder="상품명 · SKU · 업체명 검색"
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
              {round && !confirmation && (
                <button type="button" className="lg-btn-ghost" disabled={resetting} onClick={handleResetInputs}>
                  {resetting ? '리셋 중…' : 'RESET'}
                </button>
              )}
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
              <span className="lg-bc-sku">품목코드</span>
              <span style={{ flex: '1 1 auto' }}>상품명</span>
              <span className="lg-bc-bar">바코드</span>
              <span className="lg-bc-vendor">업체명</span>
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
                  <div key={vendor} className="lg-vendor-group">
                    <div className="lg-vendor-head">
                      <span className="lg-vendor-pill">
                        {vendor}
                        <span className="lg-vp-cnt">· {rows.length}건</span>
                      </span>
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

          {!round && (
            <div className="lg-card lg-empty" style={{ marginTop: 12 }}>
              열린 발주 라운드가 없습니다. 본사에서 라운드를 개설해야 입력이 가능합니다.
            </div>
          )}
        </>
      )}

      {toast && <div className="lg-toast">{toast}</div>}

      {editVoucher && confirmation && (
        <VoucherEditModal
          confirmationId={confirmation.id}
          voucher={editVoucher}
          onClose={() => setEditVoucher(null)}
          onChanged={(msg) => { showToast(msg); loadData(locationId); }}
        />
      )}

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
