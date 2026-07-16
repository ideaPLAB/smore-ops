import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// 포스 자가사용 리스트 업로드 — 파일을 파싱해 self_use_entries에 사유 미입력(deducted=false) 상태로 적재.
// 서버 service_role 키로 처리하여 RLS 우회 (상품 import와 동일 패턴). 사유는 화면에서 나중에 입력.

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role 환경변수 없음');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

const norm = (v: unknown) => String(v ?? '').trim();

function findCol(headers: string[], names: string[]): number {
  for (const n of names) {
    const i = headers.indexOf(n);
    if (i !== -1) return i;
  }
  return -1;
}

function toDateStr(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = norm(v);
  const m = s.match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return null;
}

// 코드 목록을 청크로 나눠 products를 조회해 map 채우기 (Supabase 기본 1000행 제한 회피).
async function fetchProductMap(
  client: SupabaseClient,
  column: 'sku' | 'barcode',
  codes: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const CHUNK = 300;
  for (let i = 0; i < codes.length; i += CHUNK) {
    const chunk = codes.slice(i, i + CHUNK);
    const { data, error } = await client.from('products').select(`id,${column}`).in(column, chunk);
    if (error) throw new Error(error.message ?? JSON.stringify(error));
    (data ?? []).forEach((p: Record<string, unknown>) => {
      const key = norm(p[column]);
      if (key) map.set(key, p.id as string);
    });
  }
  return map;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const defaultLoc = norm(formData.get('locationId')); // 드롭다운에서 선택한 매장(선택)
    if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    // 헤더 행 자동 탐지: (품목코드 또는 바코드) + 수량 을 포함하는 첫 행
    let headerIdx = -1;
    for (let i = 0; i < Math.min(raw.length, 8); i++) {
      const h = (raw[i] ?? []).map(norm);
      const hasItem = h.includes('품목코드') || h.includes('바코드') || h.includes('상품코드');
      const hasQty = h.includes('수량');
      if (hasItem && hasQty) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
      return NextResponse.json(
        { error: '헤더를 찾을 수 없습니다. (품목코드 또는 바코드) + 수량 컬럼이 필요합니다.' },
        { status: 400 },
      );
    }

    const headers = (raw[headerIdx] as unknown[]).map(norm);
    const skuIdx = findCol(headers, ['품목코드', '상품코드']);
    const bcIdx = findCol(headers, ['바코드']);
    const qtyIdx = findCol(headers, ['수량']);
    const dateIdx = findCol(headers, ['일자', '날짜', '자가사용일']);
    const remarkIdx = findCol(headers, ['적요', '비고', '메모']);
    const storeIdx = findCol(headers, ['매장', '점포', '창고']);

    // 1차 파싱 — 파일 행을 먼저 모으고, 매칭에 필요한 코드만 수집
    interface Parsed { skuV: string; bcV: string; qty: number; dateV: string | null; remark: string | null; storeName: string; }
    const parsed: Parsed[] = [];
    const skuSet = new Set<string>();
    const bcSet = new Set<string>();
    for (let i = headerIdx + 1; i < raw.length; i++) {
      const r = raw[i] ?? [];
      const skuV = skuIdx >= 0 ? norm(r[skuIdx]) : '';
      const bcV = bcIdx >= 0 ? norm(r[bcIdx]) : '';
      if (!skuV && !bcV) continue;
      parsed.push({
        skuV, bcV,
        qty: Math.round(Number(qtyIdx >= 0 ? r[qtyIdx] : NaN)),
        dateV: dateIdx >= 0 ? toDateStr(r[dateIdx]) : null,
        remark: remarkIdx >= 0 ? (norm(r[remarkIdx]) || null) : null,
        storeName: storeIdx >= 0 ? norm(r[storeIdx]) : '',
      });
      if (skuV) skuSet.add(skuV);
      if (bcV) bcSet.add(bcV);
    }

    const client = adminClient();
    const [bySku, byBc, { data: locations }] = await Promise.all([
      fetchProductMap(client, 'sku', [...skuSet]),
      fetchProductMap(client, 'barcode', [...bcSet]),
      client.from('locations').select('id,name'),
    ]);
    const locByName = new Map<string, string>();
    (locations ?? []).forEach((l: { id: string; name: string }) => locByName.set(norm(l.name), l.id));

    const today = toDateStr(new Date())!;
    const rows: {
      location_id: string; entry_date: string; product_id: string; qty: number; remark: string | null; deducted: boolean;
    }[] = [];
    const skipped: string[] = [];

    for (const p of parsed) {
      const productId = (p.skuV && bySku.get(p.skuV)) || (p.bcV && byBc.get(p.bcV)) || null;
      if (!productId) { skipped.push(`${p.skuV || p.bcV} — 미등록 상품`); continue; }
      if (!p.qty || p.qty <= 0) { skipped.push(`${p.skuV || p.bcV} — 수량 오류`); continue; }
      const locationId = (p.storeName && locByName.get(p.storeName)) || defaultLoc || '';
      if (!locationId) { skipped.push(`${p.skuV || p.bcV} — 매장 불명(파일에 매장 컬럼 넣거나 매장 선택)`); continue; }

      rows.push({
        location_id: locationId,
        entry_date: p.dateV ?? today,
        product_id: productId,
        qty: p.qty,
        remark: p.remark,
        deducted: false, // 사유는 화면에서 입력 → 그때 재고 차감
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: `등록 가능한 행이 없습니다.${skipped.length ? ' 예: ' + skipped.slice(0, 3).join(', ') : ''}` },
        { status: 400 },
      );
    }

    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await client.from('self_use_entries').insert(chunk);
      if (error) throw new Error(error.message ?? JSON.stringify(error));
      inserted += chunk.length;
    }

    return NextResponse.json({ ok: true, count: inserted, skipped: skipped.length, skippedSample: skipped.slice(0, 5) });
  } catch (e) {
    const msg = e instanceof Error ? e.message
      : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
      : JSON.stringify(e) ?? String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
