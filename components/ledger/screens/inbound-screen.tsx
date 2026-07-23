'use client';

import { useEffect, useRef, useState } from 'react';
import { getInboundOrders, receiveLine, SupabaseMissingError } from '@/lib/ledger/queries';
import type { InboundLine, InboundOrder } from '@/lib/ledger/queries';
import { downloadCsv } from '@/lib/ledger/csv';
import { UploadPreviewModal } from '@/components/ledger/upload-preview-modal';

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
      <span className="lg-col-num" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {saved
          ? <>
              <span className={`lg-tag ${isDiff ? 'lg-tag-dev' : ''}`}>{isDiff ? `조정 ${diff > 0 ? '+' : ''}${diff}` : '✓ 확인'}</span>
              <button type="button" className="lg-btn-sm" style={{ fontSize: '.7rem', padding: '2px 6px' }} onClick={() => setSaved(false)}>수정</button>
            </>
          : <button type="button" className="lg-btn-sm" disabled={saving} onClick={save}>{saving ? '…' : '입고 확인'}</button>}
      </span>
      {err && <span className="lg-col-num lg-err" style={{ fontSize: '.72rem' }}>{err}</span>}
    </div>
  );
}

function OrderCard({ order, onRefresh, dimmed }: { order: InboundOrder; onRefresh: () => void; dimmed?: boolean }) {
  const [open, setOpen] = useState(false);
  const doneCount = order.lines.filter((l) => l.qty_received != null).length;
  const allDone = doneCount === order.lines.length;

  return (
    <div className="lg-card" style={{
      marginBottom: 8,
      opacity: dimmed ? 0.6 : 1,
      background: dimmed ? 'var(--lg-surface, #f8f8f6)' : undefined,
      borderColor: dimmed ? 'var(--lg-line)' : undefined,
    }}>
      <button
        type="button"
        className="lg-board-row"
        style={{ width: '100%', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="lg-board-name" style={{ fontWeight: 700, color: dimmed ? 'var(--lg-muted)' : undefined }}>{order.order_no}</span>
        <span className="lg-col-sku lg-dim">{order.from_location_name}</span>
        <span className="lg-col-num lg-dim" style={{ fontSize: '.76rem' }}>{order.requested_at.slice(0, 10)}</span>
        <span className="lg-col-num">
          <span className={`lg-tag ${allDone ? '' : 'lg-tag-new'}`}>{allDone ? '✓ 완료' : `${doneCount}/${order.lines.length} 확인`}</span>
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
  const [showUpload, setShowUpload] = useState(false);
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const data = await getInboundOrders();
      setOrders(data);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { load(); }, []);

  function handleDownload() {
    const headers = ['전표번호', '출발지', '상태', '요청일', '품목코드', '품목명', '발주', '실입고', '검수'];
    const rows: unknown[][] = [];
    for (const o of orders) {
      for (const l of o.lines) {
        rows.push([
          o.order_no,
          o.from_location_name,
          o.status,
          o.requested_at.slice(0, 10),
          l.sku,
          l.product_name,
          l.qty_ordered,
          l.qty_received ?? '',
          l.qty_received == null ? '대기' : (l.qty_received === l.qty_ordered ? '확인' : `조정 ${l.qty_received - l.qty_ordered > 0 ? '+' : ''}${l.qty_received - l.qty_ordered}`),
        ]);
      }
    }
    downloadCsv('입고처리.csv', headers, rows);
  }

  const pending = orders.filter((o) => o.lines.some((l) => l.qty_received == null));
  const done = orders.filter((o) => o.lines.every((l) => l.qty_received != null));

  return (
    <section className="lg-screen">
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <p className="lg-sub">공급업체 입고 전표 · 매장 회수 — 전표별 확인 및 수량 조정</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button
            type="button"
            className="lg-btn-ghost"
            style={{ background: 'var(--lg-pine)', color: 'white', border: 'none', fontWeight: 600 }}
            onClick={() => setShowUpload(true)}
          >엑셀로 입고 등록</button>
          {status === 'ready' && (
            <button
              type="button"
              className="lg-btn-ghost"
              onClick={handleDownload}
              disabled={orders.length === 0}
              title={orders.length === 0 ? '내보낼 데이터가 없습니다' : undefined}
            >⬇ 엑셀 다운로드</button>
          )}
        </div>
      </div>

      {notice && (
        <div className="lg-card" style={{ background: '#E8F5E9', border: '1px solid #A5D6A7', marginBottom: 12, padding: '10px 14px', fontSize: '.83rem' }}>
          {notice}
        </div>
      )}

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
              <p style={{ fontSize: '.8rem', fontWeight: 600, color: 'var(--lg-muted)', margin: '16px 0 8px' }}>완료 (수정하려면 전표 열고 [수정] 클릭)</p>
              {done.map((o) => <OrderCard key={o.id} order={o} onRefresh={load} dimmed />)}
            </>
          )}
        </>
      )}

      {showUpload && (
        <UploadPreviewModal
          title="엑셀로 입고 등록"
          description="이카운트 구매입고 양식(품목코드·수량) 그대로 업로드하면 창고 입고 전표가 생성됩니다. 재고는 아래 목록에서 [입고 확인]할 때 반영돼요. 미매칭 건은 검역 보관됩니다."
          endpoint="/api/inbound/import"
          applyLabel="입고 전표 생성"
          onClose={() => setShowUpload(false)}
          onDone={(msg) => { setNotice(msg); load(); }}
        />
      )}
    </section>
  );
}
