'use client';

import { useEffect, useState } from 'react';
import { getInTransitOrders, TransitOrder, TransitLine, SupabaseMissingError } from '@/lib/ledger/queries';
import { downloadCsv } from '@/lib/ledger/csv';

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

// 발주·물류출고·매장검수 세 숫자로 오류 위치를 드러낸다. (mockup drawTransit 로직 그대로)
function lineNote(l: TransitLine, over: boolean): string {
  if (l.qty_shipped != null && l.qty_received != null && l.qty_shipped === l.qty_received && l.qty_shipped < l.qty_ordered) {
    return `창고 출고 ${l.qty_ordered - l.qty_shipped}개 차이 — 즉시 감지`;
  }
  if (over && l.qty_received == null) return '물류 확인 필요';
  if (l.qty_received != null) return '정상 완료';
  if (l.qty_shipped == null) return '출고 대기';
  return '이동중';
}

function Cell({ value, bad }: { value: number | null; bad: boolean }) {
  return <b className="lg-num" style={bad ? { color: 'var(--lg-rust)' } : undefined}>{value ?? '·'}</b>;
}

export function TransitScreen() {
  const [orders, setOrders] = useState<TransitOrder[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');

  useEffect(() => {
    let alive = true;
    getInTransitOrders()
      .then((rows) => {
        if (!alive) return;
        setOrders(rows);
        setStatus('ready');
      })
      .catch((e) => {
        if (!alive) return;
        if (e instanceof SupabaseMissingError) {
          setStatus('noenv');
        } else {
          setErrMsg(e?.message ?? String(e));
          setStatus('error');
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 화면에 보이는 이동중 데이터를 그대로 CSV로 — 전표별 품목 행을 펼쳐서 내보낸다.
  function handleDownload() {
    const headers = ['전표번호', '도착지', '상품코드', '상품명', '발주', '물류출고', '매장검수', '경과일', '상태'];
    const rows: unknown[][] = [];
    orders.forEach((o) => {
      const days = daysSince(o.requested_at);
      const hasUnreceived = o.lines.some((l) => l.qty_received == null);
      const over = days > 7 && hasUnreceived;
      o.lines.forEach((l) => {
        rows.push([
          o.order_no,
          o.to_location_name,
          l.sku,
          l.product_name,
          l.qty_ordered,
          l.qty_shipped ?? '',
          l.qty_received ?? '',
          hasUnreceived ? `${days}일째` : '',
          lineNote(l, over),
        ]);
      });
    });
    downloadCsv('이동중현황.csv', headers, rows);
  }

  return (
    <section className="lg-screen">
      <div className="lg-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <p className="lg-sub">창고를 떠나 매장에 닿기 전까지 — 세 숫자로 오류 위치가 보임</p>
        </div>
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

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && (
        <div className="lg-card lg-empty">Supabase 환경 변수가 없어. <code>.env.local</code>에 URL·anon key를 넣으면 실데이터가 떠.</div>
      )}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && orders.length === 0 && (
        <div className="lg-card lg-empty">이동 중인 전표가 없습니다</div>
      )}

      {status === 'ready' &&
        orders.map((o) => {
          const days = daysSince(o.requested_at);
          const hasUnreceived = o.lines.some((l) => l.qty_received == null);
          const over = days > 7 && hasUnreceived;
          const isOpen = open.has(o.id);
          return (
            <div key={o.id} className={`lg-vch${isOpen ? ' open' : ''}`}>
              <button
                type="button"
                className="lg-vch-h"
                style={over ? { background: 'var(--lg-rust-soft)' } : undefined}
                onClick={() => toggle(o.id)}
              >
                <span className="lg-vch-no">{o.order_no}</span>
                <span className="lg-vch-to">→ {o.to_location_name}</span>
                {hasUnreceived && <span className={`lg-aging${over ? ' over' : ''}`}>{days}일째</span>}
                <span className="lg-vch-caret">{isOpen ? '▲' : '▼'}</span>
              </button>
              {isOpen && (
                <div className="lg-vch-body">
                  <div className="lg-lg lg-lhead">
                    <span>상품명</span>
                    <span className="lg-col-sku">상품코드</span>
                    <span className="lg-col-nums">발주 / 물류출고 / 매장검수</span>
                  </div>
                  {o.lines.map((l, i) => (
                    <div className="lg-lg" key={`${l.product_id}-${i}`}>
                      <span>{l.product_name}</span>
                      <span className="lg-col-sku lg-mono lg-dim">{l.sku}</span>
                      <span className="lg-col-nums">
                        <span className="lg-nums">
                          <Cell value={l.qty_ordered} bad={false} /> /{' '}
                          <Cell value={l.qty_shipped} bad={l.qty_shipped != null && l.qty_shipped !== l.qty_ordered} /> /{' '}
                          <Cell
                            value={l.qty_received}
                            bad={l.qty_received != null && l.qty_received !== (l.qty_shipped ?? l.qty_ordered)}
                          />
                        </span>
                        <span className="lg-dim lg-note">{lineNote(l, over)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

      <p className="lg-hint">발주·물류출고·매장검수 세 숫자가 다르면 어디서 틀렸는지 위치가 바로 보입니다.</p>
    </section>
  );
}
