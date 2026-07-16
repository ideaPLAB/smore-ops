'use client';

import { useEffect, useRef, useState } from 'react';
import { getInboundOrders, getLocations, receiveLine, SupabaseMissingError } from '@/lib/ledger/queries';
import type { InboundLine, InboundOrder } from '@/lib/ledger/queries';

function DiffRow({ line, onSaved }: { line: InboundLine; onSaved: () => void }) {
  const [qty, setQty] = useState<string>(line.qty_received != null ? String(line.qty_received) : String(line.qty_ordered));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(line.qty_received != null);
  const [err, setErr] = useState('');

  async function save() {
    const n = Number(qty);
    if (isNaN(n) || n < 0) { setErr('유효한 수량 입력'); return; }
    setSaving(true); setErr('');
    try {
      await receiveLine(line.id, n, line.qty_received);
      setSaved(true);
      onSaved();
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  const diff = Number(qty) - line.qty_ordered;
  const isDiff = diff !== 0;

  return (
    <div className="lg-board-row">
      <span className="lg-board-name">{line.product_name}</span>
      <span className="lg-col-sku lg-mono lg-dim">{line.sku}</span>
      <span className="lg-col-num lg-mono">{line.qty_ordered}</span>
      <span className="lg-col-num">
        <input
          type="number" min="0"
          className="lg-qty-input"
          value={qty}
          disabled={saved && !saving}
          onChange={(e) => { setSaved(false); setQty(e.target.value); }}
        />
      </span>
      <span className="lg-col-num">
        {saved
          ? <span className={`lg-tag ${isDiff ? 'lg-tag-dev' : ''}`}>{isDiff ? `조정 ${diff > 0 ? '+' : ''}${diff}` : '✓ 확인'}</span>
          : <button type="button" className="lg-btn-sm" disabled={saving} onClick={save}>{saving ? '…' : '입고 확인'}</button>}
      </span>
      {err && <span className="lg-col-num lg-err" style={{ fontSize: '.72rem' }}>{err}</span>}
    </div>
  );
}

function OrderCard({ order, onRefresh }: { order: InboundOrder; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const doneCount = order.lines.filter((l) => l.qty_received != null).length;
  const allDone = doneCount === order.lines.length;

  return (
    <div className="lg-card" style={{ marginBottom: 10 }}>
      <button
        type="button"
        className="lg-board-row"
        style={{ width: '100%', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lg-board-name" style={{ fontWeight: 700 }}>{order.order_no}</span>
        <span className="lg-col-sku lg-dim">{order.from_location_name}</span>
        <span className="lg-col-num lg-dim" style={{ fontSize: '.76rem' }}>{order.requested_at.slice(0, 10)}</span>
        <span className="lg-col-num">
          <span className={`lg-tag ${allDone ? '' : 'lg-tag-new'}`}>{doneCount}/{order.lines.length} 확인</span>
        </span>
        <span className="lg-col-num" style={{ color: 'var(--lg-muted)' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{ paddingTop: 8, borderTop: '1px solid var(--lg-line)' }}>
          <div className="lg-board-head">
            <span>상품명</span>
            <span className="lg-col-sku">SKU</span>
            <span className="lg-col-num">예정</span>
            <span className="lg-col-num">실입고</span>
            <span className="lg-col-num"></span>
          </div>
          {order.lines.map((l) => (
            <DiffRow key={l.id} line={l} onSaved={onRefresh} />
          ))}
        </div>
      )}
    </div>
  );
}

export function InboundScreen() {
  const [orders, setOrders] = useState<InboundOrder[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [warehouseId, setWarehouseId] = useState<string | undefined>();

  async function load() {
    try {
      const locs = await getLocations();
      const wh = locs.find((l) => l.type === 'warehouse' && l.active);
      setWarehouseId(wh?.id);
      const data = await getInboundOrders(wh?.id);
      setOrders(data);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { load(); }, []);

  const pending = orders.filter((o) => o.lines.some((l) => l.qty_received == null));
  const done = orders.filter((o) => o.lines.every((l) => l.qty_received != null));

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">공급업체 입고 전표 · 매장 회수 — 전표별 확인 및 수량 조정</p>
        </div>
      </div>

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && <div className="lg-card lg-empty">Supabase 환경 변수 없음 — <code>.env.local</code> 설정 필요</div>}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          <div className="lg-kpis" style={{ marginBottom: 16 }}>
            <div className="lg-kpi"><div className="lg-kl">확인 대기</div><div className="lg-kv lg-warn">{pending.length}</div></div>
            <div className="lg-kpi"><div className="lg-kl">완료</div><div className="lg-kv">{done.length}</div></div>
          </div>

          {pending.length === 0 && done.length === 0 && (
            <div className="lg-card lg-empty">대기 중인 입고 전표가 없습니다</div>
          )}

          {pending.length > 0 && (
            <>
              <p style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--lg-muted)', margin: '0 0 8px' }}>확인 대기</p>
              {pending.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} />)}
            </>
          )}

          {done.length > 0 && (
            <>
              <p style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--lg-muted)', margin: '16px 0 8px' }}>완료</p>
              {done.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} />)}
            </>
          )}
        </>
      )}
    </section>
  );
}
