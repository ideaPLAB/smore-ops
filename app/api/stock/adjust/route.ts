import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role 환경변수 없음');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      product_id: string;
      location_id: string;
      actual_qty: number;
      snapshot_date: string; // YYYY-MM-DD
      note?: string;
    };
    const { product_id, location_id, actual_qty, snapshot_date, note } = body;
    if (!product_id || !location_id) return NextResponse.json({ error: '상품/매장 정보 없음' }, { status: 400 });
    if (typeof actual_qty !== 'number' || actual_qty < 0) return NextResponse.json({ error: '실사수량을 확인해 주세요' }, { status: 400 });
    if (!snapshot_date) return NextResponse.json({ error: '실사 날짜를 입력해 주세요' }, { status: 400 });

    const client = adminClient();

    // 현재 재고 조회
    const { data: balRows, error: balErr } = await client
      .from('v_stock_balance')
      .select('on_hand')
      .eq('product_id', product_id)
      .eq('location_id', location_id)
      .maybeSingle();
    if (balErr) throw new Error(balErr.message);

    const current_qty = balRows?.on_hand ?? 0;
    const qty_delta = actual_qty - current_qty;

    const { error: insErr } = await client.from('inventory_events').insert({
      event_type: 'adjustment',
      product_id,
      location_id,
      qty_delta,
      occurred_at: snapshot_date,
      source: 'webapp',
      note: note?.trim() || `실사 조정 (${snapshot_date} 기준)`,
    });
    if (insErr) throw new Error(insErr.message);

    return NextResponse.json({ ok: true, current_qty, actual_qty, qty_delta });
  } catch (e) {
    const msg = e instanceof Error ? e.message : JSON.stringify(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
