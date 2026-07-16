'use client';

import { useEffect, useRef, useState } from 'react';
import { getAllProducts, updateProductActive, updateProductOrderUnit, SupabaseMissingError } from '@/lib/ledger/queries';
import type { ProductRow } from '@/lib/ledger/types';

function ItemRow({ item, onRefresh }: { item: ProductRow; onRefresh: () => void }) {
  const [editUnit, setEditUnit] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function saveUnit() {
    if (editUnit == null) return;
    const n = parseInt(editUnit, 10);
    if (isNaN(n) || n < 1) { setErr('1 이상 입력'); return; }
    setSaving(true); setErr('');
    try {
      await updateProductOrderUnit(item.id, n);
      onRefresh();
      setEditUnit(null);
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setSaving(true); setErr('');
    try {
      await updateProductActive(item.id, !item.active);
      onRefresh();
    } catch (e) {
      setErr((e as Error)?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr style={{ borderTop: '1px solid var(--lg-line)', opacity: item.active ? 1 : 0.5 }}>
      <td style={{ padding: '8px 16px' }}>{item.name}</td>
      <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '.8rem', color: 'var(--lg-muted)' }}>{item.sku}</td>
      <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '.8rem', color: 'var(--lg-muted)' }}>{item.barcode ?? '—'}</td>
      <td style={{ padding: '8px', textAlign: 'center' }}>
        {editUnit != null ? (
          <span style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
            <input
              type="number" min="1"
              className="lg-qty-input"
              value={editUnit}
              onChange={(e) => setEditUnit(e.target.value)}
              style={{ width: 56 }}
              autoFocus
            />
            <button type="button" className="lg-btn-sm" disabled={saving} onClick={saveUnit}>저장</button>
            <button type="button" className="lg-btn-sm" onClick={() => setEditUnit(null)}>취소</button>
          </span>
        ) : (
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: 'var(--lg-pine)' }}
            onClick={() => setEditUnit(String(item.order_unit))}
          >
            {item.order_unit}
          </button>
        )}
      </td>
      <td style={{ padding: '8px', textAlign: 'center' }}>
        <button
          type="button"
          className={`lg-btn-sm${item.active ? '' : ' lg-btn-ghost'}`}
          style={{ minWidth: 64 }}
          disabled={saving}
          onClick={toggleActive}
        >
          {item.active ? '발주가능' : '발주불가'}
        </button>
      </td>
      {err && (
        <td colSpan={5} style={{ padding: '4px 16px', fontSize: '.72rem', color: 'var(--lg-rust)' }}>{err}</td>
      )}
    </tr>
  );
}

export function ItemsScreen() {
  const [items, setItems] = useState<ProductRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const data = await getAllProducts();
      setItems(data);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { load(); }, []);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadMsg('업로드 중…');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/products/import', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '업로드 실패');
      setUploadMsg(`✅ ${json.count.toLocaleString()}개 품목 등록 완료!`);
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      setUploadMsg(`❌ 오류: ${msg}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const filtered = items.filter((i) => {
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    return i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q) || (i.barcode ?? '').includes(q);
  });

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">발주가능 · 발주단위 · 바코드 — 본사만 수정 가능</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="lg-btn-main" onClick={() => fileRef.current?.click()}>
            엑셀 업로드 (품목등록 양식)
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.csv" style={{ display: 'none' }} onChange={handleFile} />
        </div>
      </div>

      {uploadMsg && (
        <div className="lg-card" style={{ background: '#FFF8E1', border: '1px solid #FFD54F', marginBottom: 12, padding: '10px 14px', fontSize: '.83rem' }}>
          ℹ️ {uploadMsg}
        </div>
      )}

      {items.length === 0 && status === 'ready' && (
        <div className="lg-banner-warn" style={{ marginBottom: 12 }}>
          ⚠ 상품 데이터가 없습니다 — 위의 [엑셀 업로드] 버튼으로 이카운트 품목등록 파일을 올려주세요.
        </div>
      )}

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && <div className="lg-card lg-empty">Supabase 환경 변수 없음 — <code>.env.local</code> 설정 필요</div>}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          <div className="lg-toolbar" style={{ marginBottom: 12 }}>
            <div className="lg-search">
              <input
                type="search"
                className="lg-input"
                placeholder="상품명 · SKU · 바코드"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            <span style={{ fontSize: '.8rem', color: 'var(--lg-muted)', alignSelf: 'center' }}>
              {filtered.length} / {items.length}개
            </span>
          </div>

          <div className="lg-card">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 16px', color: 'var(--lg-muted)', fontWeight: 600 }}>상품명</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>SKU</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>바코드</th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>발주단위</th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>발주가능</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--lg-muted)' }}>검색 결과 없음</td></tr>
                )}
                {filtered.map((i) => (
                  <ItemRow key={i.id} item={i} onRefresh={load} />
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: '.76rem', color: 'var(--lg-muted)' }}>
            발주단위 칸을 눌러 바로 수정. 발주가능을 끄면 발주판에서 해당 상품 입력이 잠깁니다.
          </p>
        </>
      )}
    </section>
  );
}
