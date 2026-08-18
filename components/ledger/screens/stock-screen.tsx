'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRole } from '../role-context';
import { getFullStockBalance, getInTransit, getLocations, getProducts } from '@/lib/ledger/queries';
import type { StockBalanceRow, InTransitRow, LocationRow, ProductRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

interface AdjustTarget {
  product_id: string;
  product_name: string;
  sku: string;
  location_id: string;
  location_name: string;
  current_qty: number;
}

function AdjustModal({ target, onClose, onDone }: { target: AdjustTarget; onClose: () => void; onDone: (msg: string) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [actualQty, setActualQty] = useState(String(target.current_qty));
  const [snapshotDate, setSnapshotDate] = useState(today);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    const qty = parseInt(actualQty, 10);
    if (isNaN(qty) || qty < 0) { setErr('실사 수량을 확인해 주세요 (0 이상)'); return; }
    if (!snapshotDate) { setErr('실사 날짜를 입력해 주세요'); return; }
    setSaving(true); setErr('');
    try {
      const res = await fetch('/api/stock/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: target.product_id,
          location_id: target.location_id,
          actual_qty: qty,
          snapshot_date: snapshotDate,
          note: note.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '저장 실패');
      const delta = qty - target.current_qty;
      const sign = delta >= 0 ? '+' : '';
      onDone(`✅ ${target.product_name} / ${target.location_name} 재고조정 완료 (${sign}${delta}개)`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
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
        <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>재고조정</h2>
        <p style={{ margin: '0 0 14px', fontSize: '.8rem', color: 'var(--lg-muted)' }}>
          {target.sku} · {target.product_name}<br />
          <span style={{ fontWeight: 600 }}>{target.location_name}</span>
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: 'var(--lg-bg)', borderRadius: 8, padding: '8px 12px', fontSize: '.85rem' }}>
            <span style={{ color: 'var(--lg-muted)' }}>현재 OPS 재고</span>
            <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' }}>{target.current_qty}개</span>
          </div>
          <label className="lg-label">실사 수량 *</label>
          <input
            className="lg-input"
            type="number"
            min="0"
            value={actualQty}
            onChange={(e) => setActualQty(e.target.value)}
            autoFocus
          />
          <label className="lg-label">실사 기준일 *</label>
          <input
            className="lg-input"
            type="date"
            value={snapshotDate}
            max={today}
            onChange={(e) => setSnapshotDate(e.target.value)}
          />
          <label className="lg-label">사유 (선택)</label>
          <input
            className="lg-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="예: 8월 실사, 분실, 디스플레이 제외"
          />
        </div>
        {err && <p className="lg-err" style={{ marginTop: 10, fontSize: '.8rem' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="lg-btn-secondary" onClick={onClose}>취소</button>
          <button className="lg-btn-main" style={{ width: 'auto', padding: '10px 20px', marginTop: 0 }} disabled={saving} onClick={save}>
            {saving ? '저장 중…' : '조정 완료'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface StockEntry {
  product_id: string;
  name: string;
  sku: string;
  locations: Record<string, { on_hand: number; in_transit: number }>;
}

export function StockScreen() {
  const { role } = useRole();
  const canAdjust = role === 'admin' || role === 'hq';
  const [balances, setBalances] = useState<StockBalanceRow[]>([]);
  const [transits, setTransits] = useState<InTransitRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<AdjustTarget | null>(null);
  const [adjustMsg, setAdjustMsg] = useState('');

  function reload() {
    setLoading(true);
    Promise.all([getFullStockBalance(), getInTransit(), getLocations(), getProducts()])
      .then(([b, t, l, p]) => {
        setBalances(b);
        setTransits(t);
        setLocations(l.filter((loc) => loc.active));
        setProducts(p);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  // 재고현황은 물류·본사·매장 모두 전체 위치 열람 (2026-07-19 나츠 지시)
  const visibleLocations = locations;

  const prodMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  );

  // 재고 집계: 상품별 위치 map
  const entries = useMemo<StockEntry[]>(() => {
    const map: Record<string, StockEntry> = {};
    for (const b of balances) {
      if (!map[b.product_id]) {
        const p = prodMap[b.product_id];
        if (!p) continue;
        map[b.product_id] = { product_id: b.product_id, name: p.name, sku: p.sku, locations: {} };
      }
      map[b.product_id].locations[b.location_id] = {
        on_hand: b.on_hand,
        in_transit: 0,
      };
    }
    for (const t of transits) {
      if (!map[t.product_id]) continue;
      if (!map[t.product_id].locations[t.location_id]) {
        map[t.product_id].locations[t.location_id] = { on_hand: 0, in_transit: 0 };
      }
      map[t.product_id].locations[t.location_id].in_transit = t.in_transit;
    }
    return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [balances, transits, prodMap]);

  const filtered = useMemo(() => {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(q) || e.sku.toLowerCase().includes(q));
  }, [entries, query]);

  // 화면 테이블에 보이는 그대로 CSV 내보내기
  const showTransit = role === 'hq' || role === 'admin';
  function handleDownload() {
    const headers = [
      'SKU',
      '상품명',
      ...visibleLocations.map((l) => l.name),
      ...(showTransit ? ['이동중'] : []),
      'Total',
    ];
    const rows: unknown[][] = filtered.map((e) => {
      const locTotal = visibleLocations.reduce((s, l) => s + (e.locations[l.id]?.on_hand ?? 0), 0);
      const trTotal = Object.values(e.locations).reduce((s, v) => s + v.in_transit, 0);
      return [
        e.sku,
        e.name,
        ...visibleLocations.map((l) => e.locations[l.id]?.on_hand ?? 0),
        ...(showTransit ? [trTotal] : []),
        locTotal + trTotal,
      ];
    });
    downloadCsv('재고현황.csv', headers, rows);
  }

  // KPI
  const whIds = locations.filter((l) => l.type === 'warehouse').map((l) => l.id);
  const stIds = locations.filter((l) => l.type === 'store' || l.type === 'popup').map((l) => l.id);
  const totalWh = balances.filter((b) => whIds.includes(b.location_id)).reduce((s, b) => s + b.on_hand, 0);
  const totalSt = balances.filter((b) => stIds.includes(b.location_id)).reduce((s, b) => s + b.on_hand, 0);
  const totalTr = transits.reduce((s, t) => s + t.in_transit, 0);

  return (
    <div>
      {adjustTarget && (
        <AdjustModal
          target={adjustTarget}
          onClose={() => setAdjustTarget(null)}
          onDone={(msg) => { setAdjustMsg(msg); setAdjustTarget(null); reload(); }}
        />
      )}
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="lg-sub">매장 / 창고 / 이동중 — 역할에 맞는 범위만{canAdjust ? ' · 셀 클릭으로 재고조정' : ''}</p>
        {!loading && !err && (
          <div style={{ flexShrink: 0 }}>
            <button
              type="button"
              className="lg-btn-ghost"
              onClick={handleDownload}
              disabled={filtered.length === 0}
              title={filtered.length === 0 ? '내보낼 데이터가 없습니다' : undefined}
            >
              ⬇ 엑셀 다운로드
            </button>
          </div>
        )}
      </div>

      {err && <p className="lg-err">{err}</p>}
      {adjustMsg && (
        <div className="lg-card" style={{ background: '#F1F8E9', border: '1px solid #AED581', marginBottom: 10, padding: '10px 14px', fontSize: '.83rem' }}>
          {adjustMsg}
        </div>
      )}

      <div className="lg-kpis" style={{ padding: 0 }}>
        <div className="lg-kpi">
          <div className="lg-kl">창고</div>
          <div className="lg-kv">{loading ? '…' : totalWh.toLocaleString()}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">이동중</div>
          <div className="lg-kv lg-warn">{loading ? '…' : totalTr.toLocaleString()}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">매장 합계</div>
          <div className="lg-kv">{loading ? '…' : totalSt.toLocaleString()}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">Total</div>
          <div className="lg-kv">{loading ? '…' : (totalWh + totalSt + totalTr).toLocaleString()}</div>
        </div>
      </div>

      <div className="lg-toolbar" style={{ padding: 0, marginTop: 12 }}>
        <input
          className="lg-input lg-search"
          type="search"
          placeholder="상품명 · SKU 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="lg-empty">불러오는 중…</p>
      ) : (
        <div className="lg-card" style={{ marginTop: 10, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--lg-bg)', borderBottom: '1px solid var(--lg-line-soft)' }}>
                <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700, color: 'var(--lg-muted)', fontSize: '.72rem' }}>SKU</th>
                <th style={{ textAlign: 'left', padding: '8px 14px', fontWeight: 700, color: 'var(--lg-muted)', fontSize: '.72rem' }}>상품명</th>
                {visibleLocations.map((l) => (
                  <th key={l.id} style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 700, color: 'var(--lg-muted)', fontSize: '.72rem', whiteSpace: 'nowrap' }}>
                    {l.name}
                  </th>
                ))}
                {(role === 'hq' || role === 'admin') && (
                  <th style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 700, color: 'var(--lg-muted)', fontSize: '.72rem' }}>이동중</th>
                )}
                <th style={{ textAlign: 'right', padding: '8px 14px', fontWeight: 700, color: 'var(--lg-muted)', fontSize: '.72rem' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={visibleLocations.length + 3} className="lg-empty">재고 데이터 없음</td>
                </tr>
              ) : (
                filtered.map((e) => {
                  const locTotal = visibleLocations.reduce((s, l) => s + (e.locations[l.id]?.on_hand ?? 0), 0);
                  const trTotal = Object.values(e.locations).reduce((s, v) => s + v.in_transit, 0);
                  return (
                    <tr key={e.product_id} style={{ borderBottom: '1px solid var(--lg-line-soft)' }}>
                      <td style={{ padding: '8px 14px', color: 'var(--lg-muted)', fontFamily: 'monospace', fontSize: '.78rem' }}>{e.sku}</td>
                      <td style={{ padding: '8px 14px' }}>{e.name}</td>
                      {visibleLocations.map((l) => {
                        const v = e.locations[l.id];
                        const qty = v?.on_hand ?? 0;
                        return (
                          <td
                            key={l.id}
                            style={{
                              padding: '8px 14px',
                              textAlign: 'right',
                              fontVariantNumeric: 'tabular-nums',
                              cursor: canAdjust ? 'pointer' : undefined,
                            }}
                            title={canAdjust ? `${l.name} 재고조정` : undefined}
                            onClick={canAdjust ? () => setAdjustTarget({
                              product_id: e.product_id,
                              product_name: e.name,
                              sku: e.sku,
                              location_id: l.id,
                              location_name: l.name,
                              current_qty: qty,
                            }) : undefined}
                          >
                            <span style={canAdjust ? { textDecoration: 'underline dotted', textDecorationColor: 'var(--lg-muted)' } : undefined}>
                              {v ? v.on_hand : '—'}
                            </span>
                          </td>
                        );
                      })}
                      {(role === 'hq' || role === 'admin') && (
                        <td style={{ padding: '8px 14px', textAlign: 'right', color: trTotal > 0 ? 'var(--lg-hazel)' : 'var(--lg-faint)', fontVariantNumeric: 'tabular-nums' }}>
                          {trTotal > 0 ? `+${trTotal}` : '—'}
                        </td>
                      )}
                      <td style={{ padding: '8px 14px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {locTotal + trTotal}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
