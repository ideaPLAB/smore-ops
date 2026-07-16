import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// 온라인 출고 파일 업로드 (스마트스토어 등) — 상품명/코드로 품목 매칭 → 창고 재고 차감.
// 규약(v0_8): transfer_orders(창고→'온라인' partner, via_3pl=false) 생성.
//   라인 insert 시 on_transfer_line_insert 트리거가 창고 재고를 자동 차감(재고 부족 시 예외).
//   미매칭 행은 quarantine_rows(flow='online_ship')에 보관.
// mode=preview → 파싱·매칭만 (쓰기 없음), mode=apply → 실제 전표 생성·차감.

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

// 코드/이름 목록을 청크로 나눠 products 조회 (Supabase 기본 1000행 제한 회피).
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
interface MatchedRow extends ParsedRow { productId: string; productName: string; productSku: string; }

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

    // 헤더 행 자동 탐지: (상품명 또는 품목코드/바코드) + 수량 포함하는 첫 행
    let headerIdx = -1;
    for (let i = 0; i < Math.min(raw.length, 8); i++) {
      const h = (raw[i] ?? []).map(norm);
      const hasItem = h.includes('이카운트상품명') || h.includes('상품명') || h.includes('품목명')
        || h.includes('품목코드') || h.includes('상품코드') || h.includes('바코드');
      const hasQty = h.includes('수량');
      if (hasItem && hasQty) { headerIdx = i; break; }
    }
    if (headerIdx === -1) {
      return NextResponse.json(
        { error: '헤더를 찾을 수 없습니다. (상품명 또는 품목코드/바코드) + 수량 컬럼이 필요합니다.' },
        { status: 400 },
      );
    }

    const headers = (raw[headerIdx] as unknown[]).map(norm);
    const nameIdx = findCol(headers, ['이카운트상품명', '상품명', '품목명']);
    const skuIdx = findCol(headers, ['품목코드', '상품코드']);
    const bcIdx = findCol(headers, ['바코드']);
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

    // 매칭: 품목코드 → 바코드 → 상품명 순
    const matched: MatchedRow[] = [];
    const unmatched: ParsedRow[] = [];
    for (const p of parsed) {
      const hit = (p.sku && bySku.get(p.sku)) || (p.barcode && byBc.get(p.barcode)) || (p.name && byName.get(p.name)) || null;
      if (!hit || !p.qty || p.qty <= 0) { unmatched.push(p); continue; }
      matched.push({ ...p, productId: hit.id, productName: hit.name, productSku: hit.sku });
    }

    // 상품별 수량 합산
    const aggMap = new Map<string, { productId: string; productName: string; productSku: string; qty: number }>();
    for (const m of matched) {
      const cur = aggMap.get(m.productId);
      if (cur) cur.qty += m.qty;
      else aggMap.set(m.productId, { productId: m.productId, productName: m.productName, productSku: m.productSku, qty: m.qty });
    }
    const agg = [...aggMap.values()];

    // ── 미리보기: 쓰기 없이 매칭 결과만 반환 ──
    if (mode !== 'apply') {
      const rows = [
        ...agg.map((a) => ({ name: a.productName, code: a.productSku, qty: a.qty, status: 'matched' as const, detail: '창고 차감 예정' })),
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

    // ── 적용: 전표 생성 + 창고 차감 ──
    if (agg.length === 0) {
      return NextResponse.json({ error: '매칭된 상품이 없습니다. 파일의 상품명/코드를 확인하세요.' }, { status: 400 });
    }

    // 창고
    const { data: whRows, error: whErr } = await client
      .from('locations').select('id,name').eq('type', 'warehouse').eq('active', true).limit(1);
    if (whErr) throw new Error(whErr.message);
    const warehouse = whRows?.[0];
    if (!warehouse) return NextResponse.json({ error: '활성 창고(warehouse)를 찾을 수 없습니다.' }, { status: 400 });

    // '온라인' 거래처 (없으면 생성)
    let onlineId: string;
    const { data: onRows } = await client.from('locations').select('id').eq('name', '온라인').eq('type', 'partner').limit(1);
    if (onRows?.[0]) {
      onlineId = onRows[0].id;
    } else {
      const { data: ins, error: insErr } = await client
        .from('locations').insert({ name: '온라인', type: 'partner', active: true }).select('id').single();
      if (insErr) throw new Error('온라인 거래처 생성 실패: ' + insErr.message);
      onlineId = ins.id;
    }

    // 전표번호 ON-YYYYMMDD-N
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const { count } = await client
      .from('transfer_orders').select('id', { count: 'exact', head: true }).like('order_no', `ON-${ymd}-%`);
    const orderNo = `ON-${ymd}-${(count ?? 0) + 1}`;

    const { data: order, error: ordErr } = await client
      .from('transfer_orders')
      .insert({ order_no: orderNo, from_location: warehouse.id, to_location: onlineId, via_3pl: false, status: 'requested', note: '온라인 출고 업로드' })
      .select('id').single();
    if (ordErr) throw new Error(ordErr.message);

    // 라인 개별 insert — 트리거가 창고 차감 + 재고부족 시 예외 → 부족분은 검역
    const nowIso = now.toISOString();
    let applied = 0;
    const stockFail: { productName: string; qty: number; reason: string }[] = [];
    for (const a of agg) {
      const { data: line, error: lineErr } = await client
        .from('transfer_order_lines')
        .insert({ transfer_order_id: order.id, product_id: a.productId, qty_ordered: a.qty })
        .select('id').single();
      if (lineErr) {
        stockFail.push({ productName: a.productName, qty: a.qty, reason: lineErr.message });
        continue;
      }
      // 즉시 출고 완료 기록 (qty_shipped만 — qty_received는 검수 트리거를 타지 않도록 건드리지 않음)
      await client.from('transfer_order_lines').update({ qty_shipped: a.qty, shipped_at: nowIso }).eq('id', line.id);
      applied += 1;
    }

    if (applied === 0) {
      // 아무 것도 못 넣었으면 빈 전표 제거
      await client.from('transfer_orders').delete().eq('id', order.id);
    } else {
      // 종결 처리 — 출고대기열/입고검수에서 제외
      await client.from('transfer_orders').update({ status: 'received' }).eq('id', order.id);
    }

    // 검역 보관: 미매칭 + 재고부족
    const quarantine = [
      ...unmatched.map((u) => ({ flow: 'online_ship', raw: u.raw, reason: !u.qty || u.qty <= 0 ? 'parse_error' : 'sku_not_found' })),
      ...stockFail.map((s) => ({ flow: 'online_ship', raw: { 상품명: s.productName, 수량: s.qty, 사유: s.reason }, reason: 'insufficient_stock' })),
    ];
    if (quarantine.length > 0) {
      await client.from('quarantine_rows').insert(quarantine);
    }

    return NextResponse.json({
      ok: true,
      orderNo: applied > 0 ? orderNo : null,
      applied,
      quarantined: quarantine.length,
      message: applied > 0
        ? `✅ 온라인 출고 ${applied}건 창고 차감 (전표 ${orderNo})${quarantine.length ? ` · 검역 ${quarantine.length}건` : ''}`
        : `등록된 출고 없음 — 검역 ${quarantine.length}건 (재고부족/미매칭)`,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message
      : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message)
      : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
