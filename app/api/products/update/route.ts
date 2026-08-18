import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role 환경변수 없음');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      id: string;
      active?: boolean;
      order_unit?: number;
      sku?: string;
      name?: string;
      barcode?: string;
      vendor_name?: string;
      supply_type?: string;
    };
    const { id, ...fields } = body;
    if (!id) return NextResponse.json({ error: '품목 id 없음' }, { status: 400 });

    const allowed: Record<string, unknown> = {};
    if (typeof fields.active === 'boolean') allowed.active = fields.active;
    if (typeof fields.order_unit === 'number' && fields.order_unit >= 1) allowed.order_unit = fields.order_unit;
    if (typeof fields.sku === 'string' && fields.sku.trim()) allowed.sku = fields.sku.trim();
    if (typeof fields.name === 'string' && fields.name.trim()) allowed.name = fields.name.trim();
    if (typeof fields.barcode === 'string') allowed.barcode = fields.barcode.trim() || null;
    if (typeof fields.vendor_name === 'string') allowed.vendor_name = fields.vendor_name.trim() || null;
    if (typeof fields.supply_type === 'string') allowed.supply_type = fields.supply_type.trim() || null;
    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: '변경할 필드 없음' }, { status: 400 });
    }

    const client = adminClient();
    const { error } = await client.from('products').update(allowed).eq('id', id);
    if (error) {
      const msg = error.message ?? JSON.stringify(error);
      throw new Error(msg);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message :
      (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) :
      JSON.stringify(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
