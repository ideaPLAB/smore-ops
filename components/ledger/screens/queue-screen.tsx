'use client';

import { useEffect, useRef, useState } from 'react';
import { getWarehouseQueue, shipLine } from '@/lib/ledger/queries';
import type { QueueItem } from '@/lib/ledger/queries';
import { downloadCsv } from '@/lib/ledger/csv';

// 전표별로 그룹핑
function groupByOrder(items: QueueItem[]): Record<string, QueueItem[]> {
  return items.reduce<Record<string, QueueItem[]>>((acc, item) => {
    if (!acc[item.order_no]) acc[item.order_no] = [];
    acc[item.order_no].push(item);
    return acc;
  }, {});
}

function QueueLineRow({ item, onRefresh }: { item: QueueItem; onRefresh: () => void }) {
  const [qty, setQty] = useState<string>(item.qty_shipped != null ? String(item.qty_shipped) : String(item.qty_ordered));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const done = item.qty_shipped != null;

  async function ship() {
    const n = Number(qty);
    if (isNaN(n) || n < 0) { setErr('유효한 수량 입력'); return; }
    setSaving(true); setErr('');
    try {
      await shipLine(item.line_id, n);
      onRefresh();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px',
        borderBottom: '1px solid var(--lg-line-soft)', fontSize: '.85rem', flexWrap: 'wrap',
      }}
    >
      <span style={{ fontFamily: 'monospace', fontSize: '.75rem', flex: '0 0 90px', color: 'var(--lg-muted)' }}>{item.sku}</span>
      <span style={{ flex: 1, minWidth: 120 }}>{item.name}</span>
      <span style={{ flex: '0 0 60px', textAlign: 'right', color: 'var(--lg-muted)', fontSize: '.82rem' }}>발주 {item.qty_ordered}</span>
      <input
        type="number"
        min="0"
        className="lg-qty-input"
        value={qty}
        disabled={done}
        onChange={(e) => setQty(e.target.value)}
        style={{ flex: '0 0 72px' }}
      />
      {!done ? (
        <button className="lg-btn-ghost" disabled={saving} onClick={ship} style={{ flex: '0 0 auto' }}>
          {saving ? '처리 중…' : '출고처리'}
        </button>
      ) : (
        <span style={{ flex: '0 0 auto', color: 'var(--lg-pine)', fontWeight: 700, fontSize: '.78rem' }}>
          ✓ {item.qty_shipped}개 출고
        </span>
      )}
      {item.qty_shipped != null && item.qty_shipped !== item.qty_ordered && (
        <span style={{ flex: '0 0 auto', color: 'var(--lg-hazel)', fontSize: '.75rem' }}>
          수량 차이 {item.qty_ordered - item.qty_shipped}
        </span>
      )}
      {err && <span className="lg-err" style={{ flex: '1 0 100%', fontSize: '.75rem' }}>{err}</span>}
    </div>
  );
}

function OrderAccordion({ orderNo, items, onRefresh }: { orderNo: string; items: QueueItem[]; onRefresh: () => void }) {
  const [open, setOpen] = useState(true);
  const aging = Math.floor((Date.now() - new Date(items[0].requested_at).getTime()) / 86400000);
  const toStore = items[0].to_store;
  const doneCount = items.filter((i) => i.qty_shipped != null).length;

  return (
    <div className="lg-vch">
      <button type="button" className="lg-vch-h" onClick={() => setOpen((v) => !v)}>
        <span className="lg-vch-no">{orderNo}</span>
        <span className="lg-vch-to">{toStore}</span>
        {aging > 7 && <span className="lg-aging over">{aging}일 경과</span>}
        {aging <= 7 && aging > 0 && <span className="lg-aging">{aging}일 경과</span>}
        <span style={{ marginLeft: 'auto', color: 'var(--lg-muted)', fontSize: '.78rem' }}>
          {doneCount}/{items.length} 처리
        </span>
        <span className="lg-vch-caret">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="lg-vch-body" style={{ padding: 0 }}>
          {items.map((item) => (
            <QueueLineRow key={item.line_id} item={item} onRefresh={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

export function QueueScreen() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const version = useRef(0);

  function load() {
    const v = ++version.current;
    getWarehouseQueue()
      .then((data) => { if (v === version.current) setItems(data); })
      .catch((e) => setErr(e.message))
      .finally(() => { if (v === version.current) setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  const grouped = groupByOrder(items);
  const orderNos = Object.keys(grouped);

  const totalOrders = orderNos.length;
  const waitingOrders = orderNos.filter((no) => grouped[no].some((i) => i.qty_shipped == null)).length;

  function handleDownload() {
    const headers = ['전표번호', '도착지', '품목코드', '바코드', '품목명', '발주', '출고', '상태'];
    const rows = orderNos.flatMap((no) =>
      grouped[no].map((i) => [
        i.order_no,
        i.to_store,
        i.sku,
        i.barcode ?? '',
        i.name,
        i.qty_ordered,
        i.qty_shipped ?? '',
        i.ship_status,
      ]),
    );
    downloadCsv('출고대기열.csv', headers, rows);
  }

  return (
    <div>
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <p className="lg-sub">전표를 펼쳐 피킹 수량 입력 → 전표 단위 출고처리</p>
        <button
          type="button"
          className="lg-btn-ghost"
          onClick={handleDownload}
          disabled={items.length === 0}
          title={items.length === 0 ? '내보낼 데이터가 없습니다' : undefined}
        >⬇ 엑셀 다운로드</button>
      </div>

      {err && <p className="lg-err">{err}</p>}

      <div className="lg-kpis" style={{ padding: 0 }}>
        <div className="lg-kpi">
          <div className="lg-kl">전표 수</div>
          <div className="lg-kv">{loading ? '…' : totalOrders}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">처리 대기</div>
          <div className="lg-kv lg-warn">{loading ? '…' : waitingOrders}</div>
        </div>
      </div>

      {loading ? (
        <p className="lg-empty">불러오는 중…</p>
      ) : orderNos.length === 0 ? (
        <div className="lg-card lg-empty" style={{ marginTop: 12 }}>대기 중인 출고 전표 없음</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {orderNos.map((no) => (
            <OrderAccordion key={no} orderNo={no} items={grouped[no]} onRefresh={load} />
          ))}
        </div>
      )}

      <p className="lg-hint">발주와 다르게 처리하면 즉시 표시되고, 미출고분은 창고로 자동 복원됩니다.</p>
    </div>
  );
}
