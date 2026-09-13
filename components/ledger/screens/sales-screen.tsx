'use client';

import { useEffect, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  getLocations,
  getProductsForSalesMatch,
  getSalesAsof,
  getSalesUploadHistory,
  upsertPosSales,
  SupabaseMissingError,
} from '@/lib/ledger/queries';
import type { SalesUploadStat, PosSaleRow } from '@/lib/ledger/queries';

// POS(이카운트 매출양식) 엑셀 컬럼. 출하창고 앞 3자리 = 매장코드(locations.ecount_code), 뒤는 포스기 번호.
const REQUIRED_COLS = ['일자', '출하창고', '품목코드', '수량'] as const;

interface UnmatchedRow {
  sku: string;
  name: string;
  qty: number;
  reason: string;
}

interface Preview {
  fileName: string;
  dateFrom: string;
  dateTo: string;
  rows: PosSaleRow[];
  perStore: { store: string; rowCount: number; qty: number }[];
  matchedRows: number;
  totalRows: number;
  unmatched: UnmatchedRow[];
  unknownWh: { code: string; rowCount: number }[];
}

function cellDate(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    const tz = new Date(v.getTime() - v.getTimezoneOffset() * 60000);
    return tz.toISOString().slice(0, 10);
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim().slice(0, 10).replace(/[./]/g, '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export function SalesScreen() {
  const [asof, setAsof] = useState<string | null>(null);
  const [history, setHistory] = useState<SalesUploadStat[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [dragging, setDragging] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [parsing, setParsing] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const [a, h] = await Promise.all([getSalesAsof(), getSalesUploadHistory()]);
      setAsof(a);
      setHistory(h);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { load(); }, []);

  async function parseFile(file: File) {
    setParsing(true);
    setUploadMsg('');
    setPreview(null);
    try {
      const [locations, products, buf] = await Promise.all([
        getLocations(), getProductsForSalesMatch(), file.arrayBuffer(),
      ]);

      const locByCode = new Map<string, { id: string; name: string }>();
      locations.forEach((l) => {
        if (l.ecount_code) locByCode.set(l.ecount_code, { id: l.id, name: l.name });
      });
      if (locByCode.size === 0) {
        throw new Error('매장코드 매핑이 비어 있습니다 — locations.ecount_code 설정 필요 (schema_patch_v0_35)');
      }

      const bySku = new Map<string, string>();
      const byBarcode = new Map<string, string>();
      products.forEach((p) => {
        if (p.sku) bySku.set(p.sku, p.id);
        if (p.barcode) byBarcode.set(p.barcode, p.id);
      });

      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      if (raw.length === 0) throw new Error('엑셀에 데이터 행이 없습니다');

      const missing = REQUIRED_COLS.filter((c) => !(c in raw[0]));
      if (missing.length > 0) {
        throw new Error(`필수 컬럼 누락: ${missing.join(', ')} — POS(이카운트 매출양식) 엑셀인지 확인해 주세요`);
      }

      // (일자, 매장, 상품) 단위 집계
      const agg = new Map<string, PosSaleRow>();
      const unmatchedMap = new Map<string, UnmatchedRow>();
      const unknownWhMap = new Map<string, number>();
      const perStoreMap = new Map<string, { rowCount: number; qty: number }>();
      let matchedRows = 0;
      let dateFrom = '9999-99-99';
      let dateTo = '0000-00-00';

      for (const r of raw) {
        const date = cellDate(r['일자']);
        if (!date) continue;
        const wh = String(r['출하창고']).trim();
        const sku = String(r['품목코드'] ?? '').trim();
        const barcode = String(r['바코드'] ?? '').trim();
        const qty = Number(r['수량']) || 0;
        const amount = Number(r['금액']) || 0;

        const loc = locByCode.get(wh.slice(0, 3));
        if (!loc) {
          unknownWhMap.set(wh, (unknownWhMap.get(wh) ?? 0) + 1);
          continue;
        }

        const pid = bySku.get(sku) ?? (barcode ? byBarcode.get(barcode) : undefined);
        if (!pid) {
          const u = unmatchedMap.get(sku) ?? { sku, name: String(r['품목명'] ?? ''), qty: 0, reason: 'sku_not_found' };
          u.qty += qty;
          unmatchedMap.set(sku, u);
          continue;
        }

        const k = `${date}|${loc.id}|${pid}`;
        const row = agg.get(k) ?? { sale_date: date, location_id: loc.id, product_id: pid, qty: 0, amount: 0 };
        row.qty += qty;
        row.amount = (row.amount ?? 0) + amount;
        agg.set(k, row);

        const ps = perStoreMap.get(loc.name) ?? { rowCount: 0, qty: 0 };
        ps.rowCount += 1;
        ps.qty += qty;
        perStoreMap.set(loc.name, ps);
        matchedRows += 1;
        if (date < dateFrom) dateFrom = date;
        if (date > dateTo) dateTo = date;
      }

      if (agg.size === 0) throw new Error('매칭된 행이 없습니다 — 매장코드/품목코드를 확인해 주세요');

      // 판매·취소가 상쇄돼 순수량 0인 집계행은 재고 변화가 없으므로 제외
      // (inventory_events는 qty_delta<>0 제약이 있어 0이 섞이면 업로드 전체가 실패함)
      const uploadRows = Array.from(agg.values()).filter((r) => r.qty !== 0);

      setPreview({
        fileName: file.name,
        dateFrom,
        dateTo,
        rows: uploadRows,
        perStore: Array.from(perStoreMap.entries()).map(([store, v]) => ({ store, ...v })),
        matchedRows,
        totalRows: raw.length,
        unmatched: Array.from(unmatchedMap.values()),
        unknownWh: Array.from(unknownWhMap.entries()).map(([code, rowCount]) => ({ code, rowCount })),
      });
    } catch (e) {
      setUploadMsg(`파일 분석 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function confirmUpload() {
    if (!preview || uploading) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const quarantine = preview.unmatched.map((u) => ({ ...u, _reason: u.reason, file: preview.fileName }));
      const res = await upsertPosSales(preview.rows, quarantine);
      setUploadMsg(`✅ 업로드 완료 — ${res.processed}행 반영 (판매 이벤트 자동 생성)${res.quarantined ? `, 미매칭 ${res.quarantined}건 검역 보관` : ''}`);
      setPreview(null);
      await load();
    } catch (e) {
      setUploadMsg(`업로드 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  function handleFile() {
    const f = fileRef.current?.files?.[0];
    if (f) parseFile(f);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) parseFile(f);
  }

  const daysSinceAsof = asof
    ? Math.floor((Date.now() - new Date(asof).getTime()) / 86400000)
    : null;
  const isStale = daysSinceAsof != null && daysSinceAsof > 7;

  const totalRows = history.reduce((s, h) => s + h.row_count, 0);
  const previewQty = preview ? preview.rows.reduce((s, r) => s + r.qty, 0) : 0;

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">POS(이카운트 매출양식) 엑셀을 올리면 판매 수량이 재고에 반영되고 주간·월간 판매와 제안수량이 재계산됩니다</p>
        </div>
        <div>
          <button
            type="button"
            className="lg-btn-main"
            onClick={() => fileRef.current?.click()}
            disabled={parsing || uploading}
          >
            {parsing ? '분석 중…' : 'POS 판매 파일 업로드'}
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={handleFile} />
        </div>
      </div>

      {isStale && (
        <div className="lg-banner-warn">
          ⚠ 판매 데이터가 {daysSinceAsof}일 경과 — 제안수량 신뢰 불가. 판매 파일을 업로드해 주세요.
        </div>
      )}

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && <div className="lg-card lg-empty">Supabase 환경 변수 없음 — <code>.env.local</code> 설정 필요</div>}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          <div className="lg-kpis">
            <div className="lg-kpi">
              <div className="lg-kl">판매 데이터 기준일</div>
              <div className="lg-kv" style={{ fontSize: '1rem', paddingTop: 6 }}>
                {asof ?? '—'}
                {isStale && <span style={{ marginLeft: 8, fontSize: '.8rem', color: 'var(--lg-rust)' }}>{daysSinceAsof}일 경과</span>}
              </div>
            </div>
            <div className="lg-kpi">
              <div className="lg-kl">DB 저장 행</div>
              <div className="lg-kv">{totalRows.toLocaleString()}</div>
            </div>
          </div>

          {/* 드롭존 */}
          <div
            className="lg-card"
            style={{
              border: `2px dashed ${dragging ? 'var(--lg-pine)' : 'var(--lg-line)'}`,
              background: dragging ? 'var(--lg-bg)' : undefined,
              textAlign: 'center',
              padding: '32px 16px',
              marginBottom: 16,
              cursor: 'pointer',
              transition: 'border-color .15s',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileRef.current?.click()}
          >
            <p style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--lg-pine)', marginBottom: 6 }}>
              POS 파일을 여기에 드래그하거나 클릭해 선택
            </p>
            <p style={{ fontSize: '.8rem', color: 'var(--lg-muted)' }}>
              품목코드 → 바코드 순 매칭 · 매칭 실패 건은 검역 보관 후 재적용 가능
            </p>
          </div>

          {uploadMsg && (
            <div className="lg-card" style={{ background: '#FFF8E1', border: '1px solid #FFD54F', marginBottom: 16, padding: '12px 16px', fontSize: '.84rem' }}>
              {uploadMsg}
            </div>
          )}

          {/* 업로드 미리보기 → 확정 */}
          {preview && (
            <div className="lg-card" style={{ marginBottom: 16, padding: '16px' }}>
              <div style={{ fontWeight: 700, fontSize: '.92rem', marginBottom: 10 }}>
                업로드 미리보기 — {preview.fileName}
              </div>
              <p style={{ fontSize: '.84rem', marginBottom: 8 }}>
                기간 <b>{preview.dateFrom} ~ {preview.dateTo}</b> · 원본 {preview.totalRows.toLocaleString()}행 중{' '}
                <b>{preview.matchedRows.toLocaleString()}행 매칭</b> · 반영 수량 <b>{previewQty.toLocaleString()}개</b> · 집계 {preview.rows.length.toLocaleString()}행
              </p>
              <table style={{ borderCollapse: 'collapse', fontSize: '.82rem', marginBottom: 10 }}>
                <tbody>
                  {preview.perStore.map((s) => (
                    <tr key={s.store}>
                      <td style={{ padding: '2px 16px 2px 0', fontWeight: 600 }}>{s.store}</td>
                      <td style={{ padding: '2px 16px 2px 0', textAlign: 'right' }}>{s.rowCount.toLocaleString()}행</td>
                      <td style={{ padding: '2px 0', textAlign: 'right' }}>수량 {s.qty.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.unknownWh.length > 0 && (
                <p style={{ fontSize: '.8rem', color: 'var(--lg-rust)', marginBottom: 6 }}>
                  ⚠ 미지정 매장코드: {preview.unknownWh.map((w) => `${w.code}(${w.rowCount}행)`).join(', ')} — 해당 행은 제외됩니다
                </p>
              )}
              {preview.unmatched.length > 0 && (
                <details style={{ fontSize: '.8rem', marginBottom: 8 }}>
                  <summary style={{ cursor: 'pointer', color: 'var(--lg-rust)' }}>
                    ⚠ 미매칭 품목 {preview.unmatched.length}종 (수량 {preview.unmatched.reduce((s, u) => s + u.qty, 0)}) — 검역 보관 후 상품 등록 시 재업로드로 반영
                  </summary>
                  <ul style={{ margin: '6px 0 0 18px' }}>
                    {preview.unmatched.map((u) => (
                      <li key={u.sku}>{u.sku} · {u.name} · 수량 {u.qty}</li>
                    ))}
                  </ul>
                </details>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="lg-btn-main" onClick={confirmUpload} disabled={uploading}>
                  {uploading ? '업로드 중…' : `${preview.rows.length.toLocaleString()}행 업로드 확정 (재고 차감 반영)`}
                </button>
                <button type="button" className="lg-btn" onClick={() => setPreview(null)} disabled={uploading}>
                  취소
                </button>
              </div>
            </div>
          )}

          {/* 업로드 이력 */}
          <div className="lg-card">
            <div style={{ fontWeight: 700, fontSize: '.88rem', padding: '12px 16px 8px', borderBottom: '1px solid var(--lg-line)' }}>
              판매 데이터 이력 (날짜별)
            </div>
            {history.length === 0 ? (
              <div className="lg-empty" style={{ padding: '20px 16px' }}>아직 데이터가 없습니다</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 16px', color: 'var(--lg-muted)', fontWeight: 600 }}>판매일</th>
                    <th style={{ textAlign: 'right', padding: '8px 16px', color: 'var(--lg-muted)', fontWeight: 600 }}>행 수</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.sale_date} style={{ borderTop: '1px solid var(--lg-line)' }}>
                      <td style={{ padding: '8px 16px', fontFamily: 'monospace' }}>{h.sale_date}</td>
                      <td style={{ padding: '8px 16px', textAlign: 'right' }}>{h.row_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="lg-hint" style={{ marginTop: 12, fontSize: '.76rem', color: 'var(--lg-muted)' }}>
            같은 날짜·매장·상품을 다시 올리면 수량이 갱신되고 차이만 보정 이벤트로 반영됩니다 (재업로드 안전).
            출하창고 코드 앞 3자리가 매장코드로 인식됩니다 (108=삼청 · 122=행궁 · 237=커먼즈행궁 · 235=토이하우스).
          </p>
        </>
      )}
    </section>
  );
}
