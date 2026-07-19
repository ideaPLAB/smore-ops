'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRole } from '../role-context';
import { getFullStockBalance, getInTransit, getLocations, getProducts } from '@/lib/ledger/queries';
import type { StockBalanceRow, InTransitRow, LocationRow, ProductRow } from '@/lib/ledger/types';
import { downloadCsv } from '@/lib/ledger/csv';

interface StockEntry {
  product_id: string;
  name: string;
  sku: string;
  locations: Record<string, { on_hand: number; in_transit: number }>;
}

export function StockScreen() {
  const { role } = useRole();
  const [balances, setBalances] = useState<StockBalanceRow[]>([]);
  const [transits, setTransits] = useState<InTransitRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    Promise.all([getFullStockBalance(), getInTransit(), getLocations(), getProducts()])
      .then(([b, t, l, p]) => {
        setBalances(b);
        setTransits(t);
        setLocations(l.filter((loc) => loc.active));
        setProducts(p);
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, []);

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
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="lg-sub">매장 / 창고 / 이동중 — 역할에 맞는 범위만</p>
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
                        return (
                          <td key={l.id} style={{ padding: '8px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {v ? v.on_hand : '—'}
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
