import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

// service_role 키로만 동작하는 서버 전용 라우트
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role 환경변수 없음');
  return createClient(url, key, { auth: { persistSession: false } });
}

interface ProductRow {
  sku: string;
  name: string;
  barcode: string | null;
  order_unit: number;
  active: boolean;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: '파일 없음' }, { status: 400 });

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const raw: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][];

    // 2행이 헤더 (1행은 회사명)
    const headers: string[] = raw[1] as string[];
    const skuIdx = headers.indexOf('품목코드');
    const nameIdx = headers.indexOf('품목명');
    const barcodeIdx = headers.indexOf('바코드');
    const orderUnitIdx = headers.indexOf('발주기준수량');
    const shareIdx = headers.indexOf('품목공유여부');

    if (skuIdx === -1 || nameIdx === -1) {
      return NextResponse.json({ error: '품목코드/품목명 컬럼을 찾을 수 없습니다. 이카운트 품목등록 양식인지 확인해 주세요.' }, { status: 400 });
    }

    const rows: ProductRow[] = [];
    const seenSku = new Set<string>();

    for (let i = 2; i < raw.length; i++) {
      const row = raw[i];
      const share = shareIdx >= 0 ? String(row[shareIdx] ?? '').trim() : '사용';
      if (share === '미사용') continue;

      const sku = String(row[skuIdx] ?? '').trim();
      if (!sku || seenSku.has(sku)) continue;
      seenSku.add(sku);

      const name = String(row[nameIdx] ?? '').trim();
      if (!name) continue;

      const barcodeRaw = String(row[barcodeIdx] ?? '').trim();
      const barcode = barcodeRaw || null;

      const unitRaw = Number(row[orderUnitIdx]);
      const order_unit = unitRaw > 0 ? unitRaw : 1;

      rows.push({ sku, name, barcode, order_unit, active: true });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: '업로드 가능한 품목이 없습니다.' }, { status: 400 });
    }

    const client = adminClient();

    // 1000개씩 나눠서 upsert
    const CHUNK = 1000;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await client
        .from('products')
        .upsert(chunk, { onConflict: 'sku' });
      if (error) throw error;
      upserted += chunk.length;
    }

    return NextResponse.json({ ok: true, count: upserted });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
