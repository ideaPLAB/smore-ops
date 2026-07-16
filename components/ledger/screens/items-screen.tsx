'use client';

import { useEffect, useRef, useState } from 'react';
import { getAllProducts, updateProductActive, updateProductOrderUnit, SupabaseMissingError } from '@/lib/ledger/queries';
import type { ProductRow } from '@/lib/ledger/types';
import { useRole } from '../role-context';

interface ItemRowProps {
  item: ProductRow;
  onRefresh: () => void;
  canDelete: boolean;
  selected: boolean;
  onSelect: (id: string, checked: boolean) => void;
}

function ItemRow({ item, onRefresh, canDelete, selected, onSelect }: ItemRowProps) {
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
    <tr style={{ borderTop: '1px solid var(--lg-line)', opacity: item.active ? 1 : 0.5, background: selected ? 'var(--lg-bg)' : undefined }}>
      {canDelete && (
        <td style={{ padding: '8px 8px', textAlign: 'center', width: 36 }}>
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(item.id, e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
        </td>
      )}
      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--lg-muted)', whiteSpace: 'nowrap' }}>{item.sku}</td>
      <td style={{ padding: '8px 8px', fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--lg-muted)', whiteSpace: 'nowrap' }}>{item.product_code ?? '—'}</td>
      <td style={{ padding: '8px 12px', fontWeight: item.active ? 600 : 400 }}>{item.name}</td>
      <td style={{ padding: '8px 8px', fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{item.barcode ?? '—'}</td>
      <td style={{ padding: '8px 8px', fontSize: '.8rem', color: 'var(--lg-muted)' }}>{item.vendor_name ?? '—'}</td>
      <td style={{ padding: '8px 8px', fontSize: '.8rem', color: 'var(--lg-muted)', whiteSpace: 'nowrap' }}>{item.supply_type ?? '—'}</td>
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
        <label className="lg-sw" title={item.active ? '발주가능 — 클릭해서 끄기' : '발주불가 — 클릭해서 켜기'}>
          <input
            type="checkbox"
            checked={item.active}
            disabled={saving}
            onChange={toggleActive}
          />
          <span className="lg-sw-slider" />
        </label>
        {err && <div style={{ fontSize: '.7rem', color: 'var(--lg-rust)', marginTop: 2 }}>{err}</div>}
      </td>
    </tr>
  );
}

export function ItemsScreen() {
  const { role } = useRole();
  const canDelete = role === 'admin' || role === 'hq';

  const [items, setItems] = useState<ProductRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [supplyFilter, setSupplyFilter] = useState('');
  const [uploadMsg, setUploadMsg] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
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
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
      setUploadMsg(`❌ 오류: ${msg}`);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function handleSelect(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  }

  function handleSelectAll(checked: boolean) {
    if (checked) setSelectedIds(new Set(filtered.map((i) => i.id)));
    else setSelectedIds(new Set());
  }

  async function handleDelete() {
    if (selectedIds.size === 0) return;
    if (!confirm(`선택한 ${selectedIds.size}개 품목을 삭제하시겠습니까? 재고 이벤트가 있는 상품은 삭제되지 않을 수 있습니다.`)) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/products/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '삭제 실패');
      setUploadMsg(`✅ ${json.count}개 품목 삭제 완료`);
      setSelectedIds(new Set());
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setUploadMsg(`❌ 삭제 오류: ${msg}`);
    } finally {
      setDeleting(false);
    }
  }

  const vendors = Array.from(new Set(items.map((i) => i.vendor_name).filter(Boolean))).sort() as string[];
  const supplyTypes = Array.from(new Set(items.map((i) => i.supply_type).filter(Boolean))).sort() as string[];

  const filtered = items.filter((i) => {
    if (vendorFilter && i.vendor_name !== vendorFilter) return false;
    if (supplyFilter && i.supply_type !== supplyFilter) return false;
    if (!searchQ.trim()) return true;
    const q = searchQ.toLowerCase();
    return (
      i.name.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      (i.product_code ?? '').toLowerCase().includes(q) ||
      (i.barcode ?? '').includes(q)
    );
  });

  const allFilteredSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id));

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">발주가능 · 발주단위 · 업체 — 본사만 수정 가능</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {canDelete && selectedIds.size > 0 && (
            <button
              type="button"
              className="lg-btn-ghost"
              style={{ color: 'var(--lg-rust)', borderColor: 'var(--lg-rust)' }}
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting ? '삭제 중…' : `선택 ${selectedIds.size}개 삭제`}
            </button>
          )}
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
          <div className="lg-toolbar" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <div className="lg-search">
              <input
                type="search"
                className="lg-input"
                placeholder="품목코드 · 상품코드 · 상품명 · 바코드"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            <select className="lg-input" value={vendorFilter} onChange={(e) => setVendorFilter(e.target.value)} style={{ maxWidth: 180 }}>
              <option value="">전체 업체</option>
              {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
            <select className="lg-input" value={supplyFilter} onChange={(e) => setSupplyFilter(e.target.value)} style={{ maxWidth: 120 }}>
              <option value="">전체 공급</option>
              {supplyTypes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: '.8rem', color: 'var(--lg-muted)', alignSelf: 'center' }}>
              {filtered.length} / {items.length}개
            </span>
          </div>

          <div className="lg-card" style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem', minWidth: canDelete ? 860 : 800 }}>
              <thead>
                <tr>
                  {canDelete && (
                    <th style={{ padding: '10px 8px', width: 36, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={allFilteredSelected}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                  )}
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--lg-muted)', fontWeight: 600 }}>품목코드</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>상품코드</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', color: 'var(--lg-muted)', fontWeight: 600 }}>상품명</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>바코드</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>업체</th>
                  <th style={{ textAlign: 'left', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>공급구분</th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>발주단위</th>
                  <th style={{ textAlign: 'center', padding: '10px 8px', color: 'var(--lg-muted)', fontWeight: 600 }}>발주가능</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={canDelete ? 9 : 8} style={{ padding: '20px 16px', textAlign: 'center', color: 'var(--lg-muted)' }}>
                      검색 결과 없음
                    </td>
                  </tr>
                )}
                {filtered.map((i) => (
                  <ItemRow
                    key={i.id}
                    item={i}
                    onRefresh={load}
                    canDelete={canDelete}
                    selected={selectedIds.has(i.id)}
                    onSelect={handleSelect}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <p style={{ marginTop: 10, fontSize: '.76rem', color: 'var(--lg-muted)' }}>
            발주단위 칸을 눌러 바로 수정. 발주가능을 끄면 발주판에서 해당 상품 입력이 잠깁니다.
            {canDelete && ' · 체크박스로 선택 후 삭제 (본사/마스터만 가능)'}
          </p>
        </>
      )}
    </section>
  );
}
