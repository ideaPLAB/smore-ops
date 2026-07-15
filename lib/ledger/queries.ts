// 재고원장 읽기 헬퍼 + RPC 래퍼.
// 상태 변경 저장은 전부 RPC(행 잠금) 경유 — read→modify→write 금지. (build_instructions_v2 0-B-2)
import { getSupabaseClient } from '@/lib/supabase';
import type { LocationRow, ProductRow, InTransitRow } from '@/lib/ledger/types';

export class SupabaseMissingError extends Error {
  constructor() {
    super('Supabase 환경 변수가 없어. .env.local 설정 먼저 해줘.');
    this.name = 'SupabaseMissingError';
  }
}

function client() {
  const supabase = getSupabaseClient();
  if (!supabase) throw new SupabaseMissingError();
  return supabase;
}

export async function getLocations(): Promise<LocationRow[]> {
  const { data, error } = await client()
    .from('locations')
    .select('id,name,type,active,ecount_code,opens_at,closes_at')
    .order('name');
  if (error) throw error;
  return (data ?? []) as LocationRow[];
}

export async function getProducts(): Promise<ProductRow[]> {
  const { data, error } = await client()
    .from('products')
    .select('id,sku,barcode,name,order_unit,lead_time_days,safety_stock,active')
    .eq('active', true)
    .order('name');
  if (error) throw error;
  return (data ?? []) as ProductRow[];
}

// 이동중 3-way 대사용: 열려 있는 출고지시 + 라인.
// 지시(qty_ordered)·물류확정(qty_shipped)·검수(qty_received) 세 숫자를 라인에서 직접 읽는다.
export interface TransitLine {
  product_id: string;
  product_name: string;
  sku: string;
  qty_ordered: number;
  qty_shipped: number | null;
  qty_received: number | null;
}

export interface TransitOrder {
  id: string;
  order_no: string;
  to_location: string;
  to_location_name: string;
  status: string;
  requested_at: string;
  lines: TransitLine[];
}

export async function getInTransitOrders(): Promise<TransitOrder[]> {
  const { data, error } = await client()
    .from('transfer_orders')
    .select(
      `id,order_no,status,requested_at,
       to_loc:locations!transfer_orders_to_location_fkey(id,name),
       lines:transfer_order_lines(
         qty_ordered,qty_shipped,qty_received,
         product:products(id,name,sku)
       )`
    )
    .in('status', ['requested', 'partially_received'])
    .order('requested_at', { ascending: false });
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((o) => ({
    id: o.id,
    order_no: o.order_no,
    status: o.status,
    requested_at: o.requested_at,
    to_location: o.to_loc?.id ?? '',
    to_location_name: o.to_loc?.name ?? '—',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (o.lines ?? []).map((l: any) => ({
      product_id: l.product?.id ?? '',
      product_name: l.product?.name ?? '—',
      sku: l.product?.sku ?? '',
      qty_ordered: l.qty_ordered,
      qty_shipped: l.qty_shipped,
      qty_received: l.qty_received,
    })),
  }));
}

// 원자 뷰: v_in_transit (제안수량·재고포지션 계산에 쓰는 파생값)
export async function getInTransit(): Promise<InTransitRow[]> {
  const { data, error } = await client().from('v_in_transit').select('product_id,location_id,in_transit');
  if (error) throw error;
  return (data ?? []) as InTransitRow[];
}

// ── 발주판 ──────────────────────────────────────────────────────────────────

export interface OrderBoardRow {
  product_id: string;
  sku: string;
  name: string;
  order_unit: number;
  status: string; // 'active' | 'new' | 'discontinued'
  location_id: string;
  location_name: string;
  on_hand: number;
  in_transit: number;
  inventory_position: number;
  sales_7d: number;
  sales_30d: number;
  dead_stock_6m: boolean;
  proposed_qty: number;
}

export interface OrderRound {
  id: string;
  title: string;
  due_at: string;
  status: string;
}

export interface OrderInput {
  round_id: string;
  product_id: string;
  location_id: string;
  proposed_qty: number;
  final_qty: number | null;
}

export async function getSalesAsof(): Promise<string | null> {
  const sb = client();
  const { data, error } = await sb.rpc('sales_asof');
  if (error) return null;
  return data as string | null;
}

export async function getOrderBoard(locationId?: string): Promise<OrderBoardRow[]> {
  let q = client()
    .from('v_order_board')
    .select('product_id,sku,name,order_unit,status,location_id,location_name,on_hand,in_transit,inventory_position,sales_7d,sales_30d,dead_stock_6m,proposed_qty')
    .order('name');
  if (locationId) q = q.eq('location_id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OrderBoardRow[];
}

export async function getCurrentRound(): Promise<OrderRound | null> {
  const { data, error } = await client()
    .from('order_rounds')
    .select('id,title,due_at,status')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as OrderRound | null;
}

export async function getOrderInputs(roundId: string, locationId?: string): Promise<OrderInput[]> {
  let q = client()
    .from('order_inputs')
    .select('round_id,product_id,location_id,proposed_qty,final_qty')
    .eq('round_id', roundId);
  if (locationId) q = q.eq('location_id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as OrderInput[];
}

export async function saveOrderInput(
  roundId: string,
  productId: string,
  locationId: string,
  finalQty: number | null,
): Promise<void> {
  const { error } = await client()
    .from('order_inputs')
    .update({ final_qty: finalQty, entered_at: new Date().toISOString() })
    .eq('round_id', roundId)
    .eq('product_id', productId)
    .eq('location_id', locationId);
  if (error) throw error;
}

// ── 출고요청 전표 생성 — from은 창고(type='warehouse'), to는 매장
export interface DispatchLine {
  product_id: string;
  product_name: string;
  sku: string;
  qty: number;
}

export async function createTransferOrder(
  toLocationId: string,
  fromLocationId: string,
  lines: DispatchLine[],
): Promise<string> {
  const sb = client();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // 오늘 전표 번호 시퀀스 (YYYYMMDD-N)
  const { count } = await sb
    .from('transfer_orders')
    .select('id', { count: 'exact', head: true })
    .like('order_no', `${today}-%`);
  const seq = (count ?? 0) + 1;
  const orderNo = `${today}-${seq}`;

  const { data: order, error: orderErr } = await sb
    .from('transfer_orders')
    .insert({
      order_no: orderNo,
      from_location: fromLocationId,
      to_location: toLocationId,
      status: 'requested',
      requested_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (orderErr) throw orderErr;

  const { error: lineErr } = await sb.from('transfer_order_lines').insert(
    lines.map((l) => ({
      transfer_order_id: order.id,
      product_id: l.product_id,
      qty_ordered: l.qty,
    })),
  );
  if (lineErr) throw lineErr;

  return orderNo;
}

// 최근 출고요청 이력 (type=out, 50건)
export interface DispatchOrder {
  id: string;
  order_no: string;
  to_location_name: string;
  status: string;
  requested_at: string;
  lines: { product_name: string; sku: string; qty_ordered: number; qty_shipped: number | null; qty_received: number | null }[];
}

export async function getRecentDispatchOrders(): Promise<DispatchOrder[]> {
  const { data, error } = await client()
    .from('transfer_orders')
    .select(
      `id,order_no,status,requested_at,
       to_loc:locations!transfer_orders_to_location_fkey(name),
       lines:transfer_order_lines(qty_ordered,qty_shipped,qty_received,product:products(name,sku))`
    )
    .neq('status', 'cancelled')
    .order('requested_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((o) => ({
    id: o.id,
    order_no: o.order_no,
    status: o.status,
    requested_at: o.requested_at,
    to_location_name: o.to_loc?.name ?? '—',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (o.lines ?? []).map((l: any) => ({
      product_name: l.product?.name ?? '—',
      sku: l.product?.sku ?? '',
      qty_ordered: l.qty_ordered,
      qty_shipped: l.qty_shipped,
      qty_received: l.qty_received,
    })),
  }));
}
