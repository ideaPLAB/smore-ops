import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service_role 환경변수 없음');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

interface ProductImportRow {
  sku: string;
  product_code: string | null;
  name: string;
  barcode: string | null;
  vendor_name: string | null;
  supply_type: string | null;
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

    // 1행: 회사명, 2행: 헤더
    const headers: string[] = raw[1] as string[];
    const skuIdx = headers.indexOf('품목코드');
    const productCodeIdx = headers.indexOf('상품코드');
    const nameIdx = headers.indexOf('품목명');
    const barcodeIdx = headers.indexOf('바코드');
    const orderUnitIdx = headers.indexOf('발주기준수량');
    const shareIdx = headers.indexOf('품목공유여부');
    const vendorIdx = headers.indexOf('품목그룹2명');   // 업체명
    const supplyIdx = headers.indexOf('품목그룹3명');   // 공급구분 (자사/위탁/사입)

    if (skuIdx === -1 || nameIdx === -1) {
      return NextResponse.json(
        { error: '품목코드/품목명 컬럼을 찾을 수 없습니다. 이카운트 품목등록 양식인지 확인해 주세요.' },
        { status: 400 }
      );
    }

    const rows: ProductImportRow[] = [];
    const seenSku = new Set<string>();

    for (let i = 2; i < raw.length; i++) {
      const row = raw[i];

      const sku = String(row[skuIdx] ?? '').trim();
      if (!sku || seenSku.has(sku)) continue;
      seenSku.add(sku);

      const name = String(row[nameIdx] ?? '').trim();
      if (!name) continue;

      const share = shareIdx >= 0 ? String(row[shareIdx] ?? '').trim() : '사용';
      const active = share !== '미사용';

      const productCodeRaw = productCodeIdx >= 0 ? String(row[productCodeIdx] ?? '').trim() : '';
      const barcodeRaw = barcodeIdx >= 0 ? String(row[barcodeIdx] ?? '').trim() : '';
      const vendorRaw = vendorIdx >= 0 ? String(row[vendorIdx] ?? '').trim() : '';
      const supplyRaw = supplyIdx >= 0 ? String(row[supplyIdx] ?? '').trim() : '';

      const unitRaw = orderUnitIdx >= 0 ? Number(row[orderUnitIdx]) : NaN;
      const order_unit = !isNaN(unitRaw) && unitRaw > 0 ? unitRaw : 1;

      rows.push({
        sku,
        product_code: productCodeRaw || null,
        name,
        barcode: barcodeRaw || null,
        vendor_name: vendorRaw || null,
        supply_type: supplyRaw || null,
        order_unit,
        active,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: '업로드 가능한 품목이 없습니다.' }, { status: 400 });
    }

    const client = adminClient();

    const CHUNK = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await client
        .from('products')
        .upsert(chunk, { onConflict: 'sku' });
      if (error) {
        const msg = error.message ?? JSON.stringify(error);
        throw new Error(msg);
      }
      upserted += chunk.length;
    }

    return NextResponse.json({ ok: true, count: upserted });
  } catch (e) {
    let msg: string;
    if (e instanceof Error) {
      msg = e.message;
    } else if (e && typeof e === 'object' && 'message' in e) {
      msg = String((e as { message: unknown }).message);
    } else {
      msg = JSON.stringify(e) ?? String(e);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
