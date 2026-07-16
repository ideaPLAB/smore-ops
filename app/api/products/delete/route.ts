import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role 환경변수 없음');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function DELETE(req: NextRequest) {
  try {
    const { ids } = await req.json() as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '삭제할 품목 ID가 없습니다.' }, { status: 400 });
    }
    const client = adminClient();
    const { error } = await client.from('products').delete().in('id', ids);
    if (error) throw new Error(error.message ?? JSON.stringify(error));
    return NextResponse.json({ ok: true, count: ids.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message :
      (e && typeof e === 'object' && 'message' in e) ? String((e as { message: unknown }).message) :
      JSON.stringify(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
