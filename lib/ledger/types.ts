// 재고원장 스키마(inventory_ledger_schema.sql + v0.2~v0.9) 대응 TS 타입.
// 잔액은 저장하지 않고 v_* 뷰가 단일 출처 — 프론트는 뷰 값을 그대로 쓴다. (build_instructions_v2 §7,§8)

export type LocationType = 'store' | 'warehouse' | 'popup' | 'zerozone';

export interface LocationRow {
  id: string;
  name: string;
  type: LocationType;
  active: boolean;
  ecount_code: string | null;
  opens_at: string | null;
  closes_at: string | null;
}

export interface ProductRow {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  order_unit: number;
  lead_time_days: number;
  safety_stock: number;
  active: boolean;
}

export type TransferStatus = 'requested' | 'partially_received' | 'received' | 'cancelled';

export interface TransferOrderRow {
  id: string;
  order_no: string;
  from_location: string;
  to_location: string;
  status: TransferStatus;
  requested_at: string;
  note: string | null;
}

// v_in_transit (schema_patch_v0_6): 출고지시 − 검수, 미완료 라인만
export interface InTransitRow {
  product_id: string;
  location_id: string;
  in_transit: number;
}

// v_stock_balance: inventory_events 합산
export interface StockBalanceRow {
  product_id: string;
  location_id: string;
  on_hand: number;
}
