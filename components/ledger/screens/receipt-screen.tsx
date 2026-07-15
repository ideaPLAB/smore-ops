'use client';

import { useEffect, useRef, useState } from 'react';
import { getInboundOrders, receiveLine } from '@/lib/ledger/queries';
import type { InboundLine, InboundOrder } from '@/lib/ledger/queries';

const DIFF_REASONS = ['수량 부족', '파손', '미발송', '이미 수령 완료', '기타'];

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
        <span style={{ flex: '0 0 auto', color: 'var(--lg-pine)', fontSize: '.82rem', fontWeight: 700 }}>✓ 완료</span>
      )}
      {err && <span className="lg-err" style={{ flex: '1 0 100%', fontSize: '.78rem' }}>{err}</span>}
    </div>
  );
}

function OrderCard({ order, onRefresh }: { order: InboundOrder; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const doneCount = order.lines.filter((l) => l.qty_received != null).length;
  const aging = Math.floor((Date.now() - new Date(order.requested_at).getTime()) / 86400000);

  return (
    <div className="lg-vch">
      <button type="button" className="lg-vch-h" onClick={() => setOpen((v) => !v)}>
        <span className="lg-vch-no">{order.order_no}</span>
        <span className="lg-vch-to">{order.from_location_name}</span>
        {aging > 7 && <span className="lg-aging over">{aging}일 경과</span>}
        {aging <= 7 && aging > 0 && <span className="lg-aging">{aging}일 경과</span>}
        <span style={{ color: 'var(--lg-muted)', fontSize: '.78rem' }}>{doneCount}/{order.lines.length} 확인</span>
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

export function ReceiptScreen() {
  const [orders, setOrders] = useState<InboundOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const version = useRef(0);

  function load() {
    const v = ++version.current;
    getInboundOrders()
      .then((data) => { if (v === version.current) setOrders(data); })
      .catch((e) => setErr(e.message))
      .finally(() => { if (v === version.current) setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="lg-page-head">
        <p className="lg-sub">우리 매장에 도착하는 전표 — 펼쳐서 업체별로 확인</p>
      </div>

      {err && <p className="lg-err">{err}</p>}

      {loading ? (
        <p className="lg-empty">불러오는 중…</p>
      ) : orders.length === 0 ? (
        <div className="lg-card lg-empty">도착 대기 중인 전표 없음</div>
      ) : (
        <div>
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} onRefresh={load} />
          ))}
        </div>
      )}

      <p className="lg-hint">수량을 발주보다 적게 넣으면 차이 사유 선택이 필수입니다.</p>
    </div>
  );
}
