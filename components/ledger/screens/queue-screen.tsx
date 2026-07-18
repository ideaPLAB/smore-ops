'use client';

import { useEffect, useRef, useState } from 'react';
import { getWarehouseQueue, shipLine } from '@/lib/ledger/queries';
import type { QueueItem } from '@/lib/ledger/queries';
import { downloadCsv } from '@/lib/ledger/csv';
import { UploadPreviewModal } from '@/components/ledger/upload-preview-modal';

// 매장별로 그룹핑 — 물류는 "어느 매장에 뭘 보내야 하는지"를 매장당 전표 하나로 본다
function groupByStore(items: QueueItem[]): Record<string, QueueItem[]> {
  return items.reduce<Record<string, QueueItem[]>>((acc, item) => {
    if (!acc[item.to_store]) acc[item.to_store] = [];
    acc[item.to_store].push(item);
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
      <span style={{ fontFamily: 'monospace', fontSize: '.7rem', flex: '0 0 auto', color: 'var(--lg-faint)' }}>{item.order_no}</span>
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

function StoreAccordion({ store, items, onRefresh }: { store: string; items: QueueItem[]; onRefresh: () => void }) {
  const [open, setOpen] = useState(true);
  // 경과일은 그룹에서 가장 오래된 요청 기준
  const oldest = Math.min(...items.map((i) => new Date(i.requested_at).getTime()));
  const aging = Math.floor((Date.now() - oldest) / 86400000);
  const doneCount = items.filter((i) => i.qty_shipped != null).length;

  return (
    <div className="lg-vch">
      <button type="button" className="lg-vch-h" onClick={() => setOpen((v) => !v)}>
        <span className="lg-vch-no">{store}</span>
        <span className="lg-vch-to">{items.length}품목</span>
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
  const [showUpload, setShowUpload] = useState(false);
  const [notice, setNotice] = useState('');
  const version = useRef(0);

  function load() {
    const v = ++version.current;
    getWarehouseQueue()
      .then((data) => { if (v === version.current) setItems(data); })
      .catch((e) => setErr(e.message))
      .finally(() => { if (v === version.current) setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  const grouped = groupByStore(items);
  const storeNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b, 'ko'));

  const totalStores = storeNames.length;
  const waitingStores = storeNames.filter((s) => grouped[s].some((i) => i.qty_shipped == null)).length;

  function handleDownload() {
    const headers = ['도착지', '전표번호', '품목코드', '바코드', '품목명', '발주', '출고', '상태'];
    const rows = storeNames.flatMap((s) =>
      grouped[s].map((i) => [
        i.to_store,
        i.order_no,
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
        <p className="lg-sub">매장별로 펼쳐 피킹 수량 입력 → 출고처리</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button
            type="button"
            className="lg-btn-ghost"
            style={{ background: 'var(--lg-pine)', color: 'white', border: 'none', fontWeight: 600 }}
            onClick={() => setShowUpload(true)}
          >온라인 출고 업로드</button>
          <button
            type="button"
            className="lg-btn-ghost"
            onClick={handleDownload}
            disabled={items.length === 0}
            title={items.length === 0 ? '내보낼 데이터가 없습니다' : undefined}
          >⬇ 엑셀 다운로드</button>
        </div>
      </div>

      {notice && (
        <div className="lg-card" style={{ background: '#E8F5E9', border: '1px solid #A5D6A7', marginBottom: 12, padding: '10px 14px', fontSize: '.83rem' }}>
          {notice}
        </div>
      )}

      {err && <p className="lg-err">{err}</p>}

      <div className="lg-kpis" style={{ padding: 0 }}>
        <div className="lg-kpi">
          <div className="lg-kl">출고 대상 매장</div>
          <div className="lg-kv">{loading ? '…' : totalStores}</div>
        </div>
        <div className="lg-kpi">
          <div className="lg-kl">처리 대기 매장</div>
          <div className="lg-kv lg-warn">{loading ? '…' : waitingStores}</div>
        </div>
      </div>

      {loading ? (
        <p className="lg-empty">불러오는 중…</p>
      ) : storeNames.length === 0 ? (
        <div className="lg-card lg-empty" style={{ marginTop: 12 }}>대기 중인 출고 전표 없음</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {storeNames.map((s) => (
            <StoreAccordion key={s} store={s} items={grouped[s]} onRefresh={load} />
          ))}
        </div>
      )}

      <p className="lg-hint">발주와 다르게 처리하면 즉시 표시되고, 미출고분은 창고로 자동 복원됩니다.</p>

      {showUpload && (
        <UploadPreviewModal
          title="온라인 출고파일 업로드"
          description="스마트스토어 등 온라인 주문 출고 리스트 — 상품명/품목코드로 매칭해 창고 재고를 즉시 차감합니다. 미매칭 건은 검역 보관됩니다. (품목코드 포함 양식 권장)"
          endpoint="/api/online-ship/import"
          applyLabel="창고 차감 적용"
          onClose={() => setShowUpload(false)}
          onDone={(msg) => { setNotice(msg); load(); }}
        />
      )}
    </div>
  );
}
