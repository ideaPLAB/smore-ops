import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role 환경변수 없음');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// 이카운트에 없는 상품(가챠 사입 등)을 화면에서 한 개씩 직접 등록
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sku = String(body.sku ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!sku || !name) {
      return NextResponse.json({ error: '품목코드와 품목명은 필수입니다.' }, { status: 400 });
    }

    const unit = Number(body.order_unit);
    const row = {
      sku,
      name,
      product_code: String(body.product_code ?? '').trim() || null,
      barcode: String(body.barcode ?? '').trim() || null,
      vendor_name: String(body.vendor_name ?? '').trim() || null,
      supply_type: String(body.supply_type ?? '').trim() || null,
      order_unit: !isNaN(unit) && unit > 0 ? unit : 1,
      active: true,
    };

    const client = adminClient();

    // 품목코드 중복 방지 — 이미 있으면 안내
    const { data: exist, error: exErr } = await client
      .from('products')
      .select('id')
      .eq('sku', sku)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (exist) {
      return NextResponse.json({ error: `이미 존재하는 품목코드입니다: ${sku}` }, { status: 409 });
    }

    const { data: inserted, error } = await client
      .from('products')
      .insert(row)
      .select('id')
      .single();
    if (error) throw new Error(error.message ?? JSON.stringify(error));

    // 초기재고 — 매장별 재고조정(adjustment) 이벤트로 반영 (가챠 보충 전 매장 재고 확보)
    // init_stocks: [{location_id, qty}] 배열 우선, 구버전 단일 init_qty/init_location_id도 호환
    type Stock = { location_id: string; qty: number };
    const stocks: Stock[] = Array.isArray(body.init_stocks)
      ? (body.init_stocks as unknown[]).map((s) => {
          const o = s as { location_id?: unknown; qty?: unknown };
          return { location_id: String(o.location_id ?? '').trim(), qty: Number(o.qty) };
        })
      : [];
    const legacyQty = Number(body.init_qty);
    const legacyLoc = String(body.init_location_id ?? '').trim();
    if (stocks.length === 0 && !isNaN(legacyQty) && legacyQty > 0 && legacyLoc) {
      stocks.push({ location_id: legacyLoc, qty: legacyQty });
    }
    const evRows = stocks
      .filter((s) => s.location_id && !isNaN(s.qty) && s.qty > 0)
      .map((s) => ({
        event_type: 'adjustment',
        product_id: inserted.id,
        location_id: s.location_id,
        qty_delta: s.qty,
        source: 'webapp',
        note: '직접등록 초기재고',
      }));
    if (evRows.length > 0) {
      const { error: evErr } = await client.from('inventory_events').insert(evRows);
      if (evErr) throw new Error(`상품은 등록됐으나 초기재고 반영 실패: ${evErr.message}`);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
