import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// 엑셀로 입고 등록 (이카운트 구매입고 양식) — 품목코드/바코드/상품명으로 매칭 →
//   창고행 구매입고 전표 생성 (from_location=NULL '업체 출발', to=창고, status='requested').
//   on_transfer_line_insert 트리거는 from_location IS NULL이면 차감하지 않음(v0_7) →
//   재고는 [입고검수/입고처리]에서 입고 확인 시 store_receipt로 가산된다(2단계).
//   미매칭 행은 quarantine_rows(flow='inbound_excel')에 보관.
// mode=preview → 파싱·매칭만, mode=apply → 전표 생성.

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

async function fetchProductMap(
  client: SupabaseClient,
  column: 'sku' | 'barcode' | 'name',
  keys: string[],
): Promise<Map<string, { id: string; name: string; sku: string }>> {
  const map = new Map<string, { id: string; name: string; sku: string }>();
  const CHUNK = 300;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    const { data, error } = await client.from('products').select('id,name,sku,barcode').in(column, chunk);
    if (error) throw new Error(error.message ?? JSON.stringify(error));
    (data ?? []).forEach((p: Record<string, unknown>) => {
      const k = norm(p[column]);
      if (k && !map.has(k)) map.set(k, { id: p.id as string, name: p.name as string, sku: p.sku as string });
    });
  }
  return map;
}

interface ParsedRow { sku: string; barcode: string; name: string; qty: number; raw: Record<string, unknown>; }
interface MatchedRow { productId: string; productName: string; productSku: string; qty: number; }

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const mode = norm(formData.get('mode')) || 'preview';
    if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as unknown[][];

    let headerIdx = -1;
    for (let i = 0; i < Math.min(raw.length, 8); i++) {
      const h = (raw[i] ?? []).map(norm);
      const hasItem = h.includes('품목코드') || h.includes('상품코드') || h.includes('바코드')
        || h.includes('품목명') || h.includes('상품명');
      const hasQty = h.includes('수량');
      if (hasItem && hasQty) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
      return NextResponse.json(
        { error: '헤더를 찾을 수 없습니다. (품목코드/바코드/상품명) + 수량 컬럼이 필요합니다.' },
        { status: 400 },
      );
    }

    const headers = (raw[headerIdx] as unknown[]).map(norm);
    const skuIdx = findCol(headers, ['품목코드', '상품코드']);
    const bcIdx = findCol(headers, ['바코드']);
    const nameIdx = findCol(headers, ['품목명', '상품명']);
    const qtyIdx = findCol(headers, ['수량']);

    const parsed: ParsedRow[] = [];
    const skuSet = new Set<string>();
    const bcSet = new Set<string>();
    const nameSet = new Set<string>();
    for (let i = headerIdx + 1; i < raw.length; i++) {
      const r = raw[i] ?? [];
      const sku = skuIdx >= 0 ? norm(r[skuIdx]) : '';
      const barcode = bcIdx >= 0 ? norm(r[bcIdx]) : '';
      const name = nameIdx >= 0 ? norm(r[nameIdx]) : '';
      if (!sku && !barcode && !name) continue;
      const rowObj: Record<string, unknown> = {};
      headers.forEach((h, idx) => { if (h) rowObj[h] = norm(r[idx]); });
      parsed.push({
        sku, barcode, name,
        qty: Math.round(Number(qtyIdx >= 0 ? r[qtyIdx] : NaN)),
        raw: rowObj,
      });
      if (sku) skuSet.add(sku);
      if (barcode) bcSet.add(barcode);
      if (name) nameSet.add(name);
    }

    const client = adminClient();
    const [bySku, byBc, byName] = await Promise.all([
      fetchProductMap(client, 'sku', [...skuSet]),
      fetchProductMap(client, 'barcode', [...bcSet]),
      fetchProductMap(client, 'name', [...nameSet]),
    ]);

    const matched: MatchedRow[] = [];
    const unmatched: ParsedRow[] = [];
    for (const p of parsed) {
      const hit = (p.sku && bySku.get(p.sku)) || (p.barcode && byBc.get(p.barcode)) || (p.name && byName.get(p.name)) || null;
      if (!hit || !p.qty || p.qty <= 0) { unmatched.push(p); continue; }
      matched.push({ productId: hit.id, productName: hit.name, productSku: hit.sku, qty: p.qty });
    }

    // 상품별 수량 합산
    const aggMap = new Map<string, MatchedRow>();
    for (const m of matched) {
      const cur = aggMap.get(m.productId);
      if (cur) cur.qty += m.qty;
      else aggMap.set(m.productId, { ...m });
    }
    const agg = [...aggMap.values()];

    if (mode !== 'apply') {
      const rows = [
        ...agg.map((a) => ({ name: a.productName, code: a.productSku, qty: a.qty, status: 'matched' as const, detail: '입고 전표 생성 예정' })),
        ...unmatched.map((u) => ({
          name: u.name || u.sku || u.barcode, code: u.sku || u.barcode, qty: u.qty || 0,
          status: 'unmatched' as const,
          detail: !u.qty || u.qty <= 0 ? '수량 오류' : '미등록 상품 — 검역 보관',
        })),
      ];
      return NextResponse.json({
        ok: true,
        summary: { matched: agg.length, unmatched: unmatched.length, totalQty: agg.reduce((s, a) => s + a.qty, 0) },
        rows,
      });
    }

    if (agg.length === 0) {
      return NextResponse.json({ error: '매칭된 상품이 없습니다. 파일의 품목코드/상품명을 확인하세요.' }, { status: 400 });
    }

    const { data: whRows, error: whErr } = await client
      .from('locations').select('id,name').eq('type', 'warehouse').eq('active', true).limit(1);
    if (whErr) throw new Error(whErr.message);
    const warehouse = whRows?.[0];
    if (!warehouse) return NextResponse.json({ error: '활성 창고(warehouse)를 찾을 수 없습니다.' }, { status: 400 });

    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const { count } = await client
      .from('transfer_orders').select('id', { count: 'exact', head: true }).like('order_no', `PO-${ymd}-%`);
    const orderNo = `PO-${ymd}-${(count ?? 0) + 1}`;

    // from_location=NULL → '업체 출발': 라인 insert 트리거가 차감하지 않음. 입고 확인 시 창고 가산.
    const { data: order, error: ordErr } = await client
      .from('transfer_orders')
      .insert({ order_no: orderNo, from_location: null, to_location: warehouse.id, via_3pl: true, status: 'requested', note: '엑셀 입고 등록' })
      .select('id').single();
    if (ordErr) throw new Error(ordErr.message);

    const { error: lineErr } = await client
      .from('transfer_order_lines')
      .insert(agg.map((a) => ({ transfer_order_id: order.id, product_id: a.productId, qty_ordered: a.qty })));
    if (lineErr) {
      await client.from('transfer_orders').delete().eq('id', order.id);
      throw new Error('전표 라인 생성 실패: ' + lineErr.message);
    }

    const quarantine = unmatched.map((u) => ({
      flow: 'inbound_excel', raw: u.raw, reason: !u.qty || u.qty <= 0 ? 'parse_error' : 'sku_not_found',
    }));
    if (quarantine.length > 0) {
      await client.from('quarantine_rows').insert(quarantine);
    }

    return NextResponse.json({
      ok: true,
      orderNo,
      applied: agg.length,
      quarantined: quarantine.length,
      message: `✅ 입고 전표 ${orderNo} 생성 (${agg.length}개 품목) — 입고검수에서 확인하세요${quarantine.length ? ` · 검역 ${quarantine.length}건` : ''}`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message
      : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
      : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
