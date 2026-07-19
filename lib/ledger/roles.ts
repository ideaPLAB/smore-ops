// 재고원장(Smore Ops) 역할·화면 정의
// 프로토타입: 역할 전환 드롭다운. 배포판은 Supabase Auth(profiles.role/location_id)로 대체. (build_instructions_v2 0-A)

export type Role = 'admin' | 'hq' | 'manager' | 'warehouse';

export const ROLE_NM: Record<Role, string> = {
  admin: '마스터',
  hq: '본사',
  manager: '매장 매니저',
  warehouse: '물류',
};

// 화면 id → 라벨 (mockup smore_ledger_v2_10.html의 <h1> 문구 그대로)
export type ScreenId =
  | 'board'
  | 'stock'
  | 'receipt'
  | 'gacha'
  | 'selfuse'
  | 'transit'
  | 'dispatch'
  | 'queue'
  | 'inbound'
  | 'sales'
  | 'items'
  | 'accounts'
  | 'wiki'
  | 'guide';

export const SCREEN_NM: Record<ScreenId, string> = {
  board: '발주판',
  stock: '재고 현황',
  receipt: '입고검수',
  gacha: '가챠머신 관리',
  selfuse: '자가사용 처리',
  transit: '이동중 현황',
  dispatch: '출고요청',
  queue: '출고 대기열',
  inbound: '입고 처리',
  sales: '판매 데이터 업로드',
  items: '상품관리',
  accounts: '계정 관리',
  wiki: 'WIKI',
  guide: '사용 안내',
};

// 역할별 접근 가능한 화면 (mockup ROLE_TABS 그대로).
// admin은 마스터 → 전 화면.
export const ROLE_TABS: Record<Role, ScreenId[]> = {
  admin: ['board', 'stock', 'receipt', 'gacha', 'selfuse', 'transit', 'dispatch', 'queue', 'inbound', 'sales', 'items', 'accounts', 'wiki', 'guide'],
  hq: ['board', 'stock', 'receipt', 'gacha', 'selfuse', 'transit', 'dispatch', 'queue', 'inbound', 'sales', 'items', 'accounts', 'wiki', 'guide'],
  manager: ['board', 'stock', 'receipt', 'gacha', 'selfuse', 'guide'],
  warehouse: ['queue', 'inbound', 'stock', 'guide'],
};

export const ROLES: Role[] = ['admin', 'hq', 'manager', 'warehouse'];
