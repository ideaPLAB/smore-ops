// 재고원장 읽기 헬퍼 + RPC 래퍼.
// 상태 변경 저장은 전부 RPC(행 잠금) 경유 — read→modify→write 금지. (build_instructions_v2 0-B-2)
import { getSupabaseClient } from '@/lib/supabase';
import type { LocationRow, ProductRow, InTransitRow, StockBalanceRow } from '@/lib/ledger/types';

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
  alt_code: string | null;      // 상품코드
  barcode: string | null;       // 바코드
  supply_type: string | null;   // 공급구분(사입/자사/위탁)
  vendor_name: string | null;   // 업체명
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
    .select('product_id,sku,name,order_unit,status,location_id,location_name,on_hand,in_transit,inventory_position,sales_7d,sales_30d,dead_stock_6m,proposed_qty,alt_code,barcode,supply_type,vendor_name')
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
  // 앱은 로그인 없이 anon → order_inputs 직접 UPDATE 는 권한 거부.
  // security definer RPC(save_order_input, schema_patch_v0_13.sql)로 저장한다.
  const { error } = await client().rpc('save_order_input', {
    p_round: roundId,
    p_product: productId,
    p_location: locationId,
    p_final: finalQty,
  });
  if (error) throw error;
}

export async function resetOrderInputs(roundId: string, locationId: string): Promise<number> {
  // 확정 취소는 입력값을 복원하므로(v0_19), 입력 비우기는 이 RPC로 명시적으로 리셋한다.
  // security definer RPC(reset_order_inputs, schema_patch_v0_22.sql).
  const { data, error } = await client().rpc('reset_order_inputs', {
    p_round: roundId,
    p_location: locationId,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

// ── 발주 확정 → 전표 생성 (창고분/업체분 분리) — schema_patch_v0_12.sql ──
export interface SplitLine {
  sku: string;
  name: string;
  vendor: string;
  final_qty: number;
  warehouse_qty: number;
  vendor_qty: number;
}

export interface ConfirmResult {
  confirmation_id: string;
  order_nos: string[];
  warehouse_items: number;
  vendor_items: number;
  total_qty: number;
}

export interface SnapshotItem {
  sku: string;
  name: string;
  vendor: string;
  qty: number;
  proposed: number;
  warehouse_qty: number;
  vendor_qty: number;
}

export interface RoundConfirmation {
  id: string;
  round_id: string;
  location_id: string;
  confirmed_at: string;
  order_nos: string[];
  snapshot: SnapshotItem[];
  cancelled: boolean;
}

// 확정 전 미리보기 — 창고분/업체분 분할만 계산 (쓰기 없음).
export async function previewRoundSplit(roundId: string, locationId: string): Promise<SplitLine[]> {
  const { data, error } = await client().rpc('preview_round_split', { p_round: roundId, p_location: locationId });
  if (error) throw error;
  return (data ?? []) as SplitLine[];
}

// 발주 확정 — 전표 생성 + 확정 스냅샷 기록. 반환: 생성 전표번호·건수.
export async function confirmRoundOrders(roundId: string, locationId: string): Promise<ConfirmResult> {
  const { data, error } = await client().rpc('confirm_round_orders', { p_round: roundId, p_location: locationId });
  if (error) throw error;
  return data as ConfirmResult;
}

// 매장×라운드의 활성 확정 조회 (없으면 null).
export async function getConfirmation(roundId: string, locationId: string): Promise<RoundConfirmation | null> {
  const { data, error } = await client()
    .from('order_confirmations')
    .select('id,round_id,location_id,confirmed_at,order_nos,snapshot,cancelled')
    .eq('round_id', roundId)
    .eq('location_id', locationId)
    .eq('cancelled', false)
    .maybeSingle();
  if (error) throw error;
  return (data as RoundConfirmation | null) ?? null;
}

// 확정 취소 — 미출고·미입고 전표만 회수(창고재고 자동 복원). 시작된 전표 있으면 예외.
export async function cancelConfirmation(confirmationId: string): Promise<void> {
  const { error } = await client().rpc('cancel_confirmation', { p_confirmation: confirmationId });
  if (error) throw error;
}

// ── 확정 전표 개별 취소·수정 (v0.17)
export interface VoucherLine {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  qty_ordered: number;
  qty_shipped: number | null;
  qty_received: number | null;
}

export interface ConfirmationVoucher {
  id: string;
  order_no: string;
  status: string;
  is_vendor: boolean;       // true = 업체 구매발주(PO), false = 창고 출고요청
  vendor_name: string | null;
  lines: VoucherLine[];
}

// 확정에 속한 전표들 + 라인 조회 (수정/취소 UI용)
export async function getConfirmationVouchers(orderNos: string[]): Promise<ConfirmationVoucher[]> {
  if (orderNos.length === 0) return [];
  const { data, error } = await client()
    .from('transfer_orders')
    .select('id,order_no,status,from_location,origin_vendor:origin_vendor_id(name),transfer_order_lines(id,product_id,qty_ordered,qty_shipped,qty_received,product:product_id(sku,name))')
    .in('order_no', orderNos)
    .neq('status', 'cancelled')
    .order('order_no');
  if (error) throw error;
  type Raw = {
    id: string; order_no: string; status: string; from_location: string | null;
    origin_vendor: { name: string } | { name: string }[] | null;
    transfer_order_lines: {
      id: string; product_id: string; qty_ordered: number;
      qty_shipped: number | null; qty_received: number | null;
      product: { sku: string; name: string } | { sku: string; name: string }[] | null;
    }[];
  };
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return ((data ?? []) as Raw[]).map((t) => ({
    id: t.id,
    order_no: t.order_no,
    status: t.status,
    is_vendor: t.from_location == null,
    vendor_name: one(t.origin_vendor)?.name ?? null,
    lines: (t.transfer_order_lines ?? [])
      .map((l) => ({
        id: l.id,
        product_id: l.product_id,
        sku: one(l.product)?.sku ?? '',
        name: one(l.product)?.name ?? '',
        qty_ordered: l.qty_ordered,
        qty_shipped: l.qty_shipped,
        qty_received: l.qty_received,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
  }));
}

// 전표 1건만 취소 — 창고분은 재고 복원, 마지막 전표면 확정 자체 취소 처리.
export async function cancelConfirmationOrder(confirmationId: string, orderNo: string): Promise<{ remaining_orders: string[] }> {
  const { data, error } = await client().rpc('cancel_confirmation_order', {
    p_confirmation: confirmationId, p_order_no: orderNo,
  });
  if (error) throw error;
  return data as { remaining_orders: string[] };
}

// 전표 라인 수량 수정 (0 = 품목 제외). 창고분은 증감분 재고 보정.
export async function updateVoucherLine(
  confirmationId: string, orderNo: string, productId: string, qty: number,
): Promise<void> {
  const { error } = await client().rpc('update_voucher_line', {
    p_confirmation: confirmationId, p_order_no: orderNo, p_product: productId, p_qty: qty,
  });
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

// ── 재고 현황 ──────────────────────────────────────────────────────────────────

export async function getFullStockBalance(): Promise<StockBalanceRow[]> {
  const { data, error } = await client()
    .from('v_stock_balance')
    .select('product_id,location_id,on_hand');
  if (error) throw error;
  return (data ?? []) as StockBalanceRow[];
}

// ── 입고검수 ──────────────────────────────────────────────────────────────────

export interface InboundLine {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  qty_ordered: number;
  qty_received: number | null;
  received_at: string | null;
}

export interface InboundOrder {
  id: string;
  order_no: string;
  from_location_name: string;
  to_location_name: string;
  status: string;
  requested_at: string;
  lines: InboundLine[];
}

export async function getInboundOrders(toLocationId?: string): Promise<InboundOrder[]> {
  let q = client()
    .from('transfer_orders')
    .select(
      `id,order_no,status,requested_at,
       from_loc:locations!transfer_orders_from_location_fkey(name),
       to_loc:locations!transfer_orders_to_location_fkey(name),
       origin_vendor:vendors!transfer_orders_origin_vendor_id_fkey(name),
       lines:transfer_order_lines(
         id,qty_ordered,qty_received,received_at,
         product:products(id,name,sku)
       )`
    )
    .in('status', ['requested', 'partially_received', 'received'])
    .order('requested_at', { ascending: false })
    .limit(100);
  if (toLocationId) q = q.eq('to_location', toLocationId);
  const { data, error } = await q;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((o) => ({
    id: o.id,
    order_no: o.order_no,
    status: o.status,
    requested_at: o.requested_at,
    // 업체 직납(PO, from=NULL)은 출발지 대신 업체명을 표시
    from_location_name: o.from_loc?.name ?? (o.origin_vendor?.name ? `업체 직납 · ${o.origin_vendor.name}` : '—'),
    to_location_name: o.to_loc?.name ?? '—',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lines: (o.lines ?? []).map((l: any) => ({
      id: l.id,
      product_id: l.product?.id ?? '',
      product_name: l.product?.name ?? '—',
      sku: l.product?.sku ?? '',
      qty_ordered: l.qty_ordered,
      qty_received: l.qty_received,
      received_at: l.received_at,
    })),
  }));
}

export async function receiveLine(lineId: string, qty: number, expected?: number | null): Promise<void> {
  const { error } = await client().rpc('receive_line', {
    p_line: lineId,
    p_qty: qty,
    p_expected: expected ?? null,
  });
  if (error) throw error;
}

// 수기 입고 등록 — 전표 없이 도착한 물건을 매장 재고에 즉시 가산 (store_receipt).
// SQL: schema_patch_v0_10.sql 의 manual_receive RPC 필요.
export async function manualReceive(args: {
  productId: string;
  locationId: string;
  qty: number;
  note?: string | null;
  source?: string | null;
}): Promise<number> {
  const { data, error } = await client().rpc('manual_receive', {
    p_product: args.productId,
    p_location: args.locationId,
    p_qty: args.qty,
    p_note: args.note ?? null,
    p_source: args.source ?? null,
  });
  if (error) throw error;
  return data as number;
}

// ── 자가사용 ──────────────────────────────────────────────────────────────────

export interface SelfuseEntry {
  id: string;
  location_id: string;
  entry_date: string;
  product_id: string;
  product_name: string;
  sku: string;
  barcode: string | null;
  qty: number;
  reason: string | null;
  remark: string | null;
  deducted: boolean;
}

export async function getSelfuseEntries(locationId?: string): Promise<SelfuseEntry[]> {
  let q = client()
    .from('self_use_entries')
    .select('id,location_id,entry_date,product_id,qty,reason,remark,deducted,product:products(name,sku,barcode)')
    .order('entry_date', { ascending: false });
  if (locationId) q = q.eq('location_id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((e) => ({
    id: e.id,
    location_id: e.location_id,
    entry_date: e.entry_date,
    product_id: e.product_id,
    product_name: e.product?.name ?? '—',
    sku: e.product?.sku ?? '',
    barcode: e.product?.barcode ?? null,
    qty: e.qty,
    reason: e.reason,
    remark: e.remark,
    deducted: e.deducted,
  }));
}

export async function saveSelfuseReason(entryId: string, reason: string, remark: string): Promise<void> {
  const { error } = await client()
    .from('self_use_entries')
    .update({ reason, remark: remark || null })
    .eq('id', entryId);
  if (error) throw error;
}

// ── 가챠머신 ──────────────────────────────────────────────────────────────────

export interface GachaSlot {
  id: string;
  bin_id: string;
  bin_code: string;
  slot_no: number;
  product_id: string | null;
  product_name: string | null;
  sku: string | null;
  price: number;
  qty: number;
}

export interface GachaMachine {
  bin_id: string;
  bin_code: string;
  location_id: string;
  slots: GachaSlot[];
}

export interface GachaCheck {
  id: string;
  slot_id: string;
  slot_no: number;
  bin_code: string;
  product_name: string | null;
  counted: number;
  refill: number;
  sold_est: number;
  revenue_est: number;
  shrinkage: number;
  shrinkage_reason: string | null;
  cash_counted: number | null;
  checked_at: string;
}

export async function getGachaMachines(locationId?: string): Promise<GachaMachine[]> {
  let q = client()
    .from('bins')
    .select(
      `id,code,location_id,
       slots:gacha_slots(
         id,slot_no,price,qty,
         product:products(id,name,sku)
       )`
    )
    .eq('active', true);
  if (locationId) q = q.eq('location_id', locationId);
  const { data, error } = await q;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = ((data ?? []) as any[]).filter((b) => (b.slots ?? []).length > 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return raw.map((b) => ({
    bin_id: b.id,
    bin_code: b.code,
    location_id: b.location_id,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    slots: (b.slots ?? []).map((s: any) => ({
      id: s.id,
      bin_id: b.id,
      bin_code: b.code,
      slot_no: s.slot_no,
      product_id: s.product?.id ?? null,
      product_name: s.product?.name ?? null,
      sku: s.product?.sku ?? null,
      price: s.price,
      qty: s.qty,
    })),
  }));
}

export async function getGachaChecks(locationId?: string): Promise<GachaCheck[]> {
  const q = client()
    .from('gacha_checks')
    .select(
      `id,slot_id,counted,refill,sold_est,revenue_est,shrinkage,shrinkage_reason,cash_counted,checked_at,
       slot:gacha_slots(slot_no,bin:bins(code),product:products(name))`
    )
    .order('checked_at', { ascending: false })
    .limit(50);
  const { data, error } = await q;
  if (error) throw error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (data ?? []) as any[];
  if (locationId) {
    // 위치 필터는 bins 경유라 클라이언트에서 처리
  }
  return raw.map((c) => ({
    id: c.id,
    slot_id: c.slot_id,
    slot_no: c.slot?.slot_no ?? 0,
    bin_code: c.slot?.bin?.code ?? '—',
    product_name: c.slot?.product?.name ?? '—',
    counted: c.counted,
    refill: c.refill,
    sold_est: c.sold_est,
    revenue_est: c.revenue_est,
    shrinkage: c.shrinkage ?? 0,
    shrinkage_reason: c.shrinkage_reason,
    cash_counted: c.cash_counted,
    checked_at: c.checked_at,
  }));
}

export async function runGachaCheck(
  slotId: string,
  counted: number,
  refill: number,
  shrinkage: number,
  shrinkageReason: string | null,
  cashCounted: number | null,
): Promise<void> {
  const { error } = await client().rpc('gacha_check', {
    p_slot: slotId,
    p_counted: counted,
    p_refill: refill,
    p_shrinkage: shrinkage,
    p_shrinkage_reason: shrinkageReason,
    p_cash_counted: cashCounted,
  });
  if (error) throw error;
}

// 가챠 점검 되돌리기 — 슬롯의 가장 최근 점검 1건을 서버에서 롤백
// (역방향 이벤트 기록 + 슬롯 잔량 복원 + 점검 이력 삭제, schema_patch_v0_14.sql)
export async function undoGachaCheck(slotId: string): Promise<void> {
  const { error } = await client().rpc('gacha_check_undo', { p_slot: slotId });
  if (error) throw error;
}

// 슬롯 품목·가격 변경 (gacha_change RPC — 잔량이 있으면 매장 재고로 자동 회수)
export async function changeGachaSlot(slotId: string, productId: string, price: number): Promise<void> {
  const { error } = await client().rpc('gacha_change', {
    p_slot: slotId,
    p_product: productId,
    p_price: price,
  });
  if (error) throw error;
}

// 새 머신(bin) + 슬롯 일괄 등록
export async function createGachaMachine(
  locationId: string,
  binCode: string,
  slotCount: number,
  defaultPrice: number,
): Promise<void> {
  const supabase = client();
  const { data: bin, error: binErr } = await supabase
    .from('bins')
    .insert({ code: binCode, location_id: locationId, zone: '가챠', active: true })
    .select('id')
    .single();
  if (binErr) throw binErr;
  const slots = Array.from({ length: slotCount }, (_, i) => ({
    bin_id: bin.id,
    slot_no: i + 1,
    price: defaultPrice,
    qty: 0,
  }));
  const { error: slotsErr } = await supabase.from('gacha_slots').insert(slots);
  if (slotsErr) throw slotsErr;
}

// ── 출고 대기열 ──────────────────────────────────────────────────────────────────

export interface QueueItem {
  order_no: string;
  requested_at: string;
  line_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  to_store: string;
  qty_ordered: number;
  qty_shipped: number | null;
  shipped_at: string | null;
  ship_status: string;
}

export async function getWarehouseQueue(): Promise<QueueItem[]> {
  const { data, error } = await client()
    .from('v_warehouse_queue')
    .select('order_no,requested_at,line_id,sku,barcode,name,to_store,qty_ordered,qty_shipped,shipped_at,ship_status');
  if (error) throw error;
  return (data ?? []) as QueueItem[];
}

export async function shipLine(lineId: string, qtyShipped: number): Promise<void> {
  const { error } = await client()
    .from('transfer_order_lines')
    .update({ qty_shipped: qtyShipped, shipped_at: new Date().toISOString() })
    .eq('id', lineId);
  if (error) throw error;
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

// ── 상품관리 ──────────────────────────────────────────────────────────────────

const PRODUCT_COLS =
  'id,sku,product_code,barcode,name,vendor_name,supply_type,order_unit,lead_time_days,safety_stock,active';

export async function getAllProducts(): Promise<ProductRow[]> {
  // Supabase/PostgREST는 요청당 기본 1000행까지만 반환한다.
  // 전체 개수를 먼저 구한 뒤 페이지들을 병렬 조회해서 순차 왕복 지연을 줄인다.
  const PAGE = 1000;
  const { count, error: cErr } = await client()
    .from('products')
    .select('id', { count: 'exact', head: true });
  if (cErr) throw cErr;

  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) =>
      client()
        .from('products')
        .select(PRODUCT_COLS)
        .order('name')
        .range(p * PAGE, p * PAGE + PAGE - 1),
    ),
  );
  const all: ProductRow[] = [];
  for (const { data, error } of results) {
    if (error) throw error;
    all.push(...((data ?? []) as ProductRow[]));
  }
  return all;
}

export async function updateProductOrderUnit(productId: string, orderUnit: number): Promise<void> {
  const { error } = await client()
    .from('products')
    .update({ order_unit: orderUnit })
    .eq('id', productId);
  if (error) throw error;
}

export async function updateProductActive(productId: string, active: boolean): Promise<void> {
  const { error } = await client()
    .from('products')
    .update({ active })
    .eq('id', productId);
  if (error) throw error;
}

// ── 판매 데이터 업로드 이력 ───────────────────────────────────────────────────

export interface SalesUploadStat {
  sale_date: string;
  row_count: number;
}

export async function getSalesUploadHistory(): Promise<SalesUploadStat[]> {
  const { data, error } = await client()
    .from('pos_sales_daily')
    .select('sale_date')
    .order('sale_date', { ascending: false })
    .limit(200);
  if (error) throw error;
  const map = new Map<string, number>();
  (data ?? []).forEach((r: { sale_date: string }) => {
    map.set(r.sale_date, (map.get(r.sale_date) ?? 0) + 1);
  });
  return Array.from(map.entries()).map(([sale_date, row_count]) => ({ sale_date, row_count }));
}
