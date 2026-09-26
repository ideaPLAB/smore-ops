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
  | 'home'
  | 'notices'
  | 'manuals'
  | 'board'
  | 'stock'
  | 'receipt'
  | 'gacha'
  | 'selfuse'
  | 'transit'
  | 'dispatch'
  | 'queue'
  | 'inbound'
  | 'store-transfer'
  | 'sales'
  | 'items'
  | 'accounts'
  | 'wiki'
  | 'guide';

export const SCREEN_NM: Record<ScreenId, string> = {
  home: '홈',
  notices: '공지사항',
  manuals: '운영매뉴얼',
  board: '발주판',
  stock: '재고 현황',
  receipt: '입고검수',
  gacha: '가챠머신 관리',
  selfuse: '자가사용 처리',
  transit: '이동중 현황',
  dispatch: '출고요청',
  queue: '출고 대기열',
  inbound: '입고 처리',
  'store-transfer': '매장 간 재고이동',
  sales: '판매 데이터 업로드',
  items: '상품관리',
  accounts: '계정 관리',
  wiki: 'WIKI',
  guide: '사용 안내',
};

// 역할별 접근 가능한 화면.
// admin은 마스터 → 전 화면. 계정 관리(accounts)는 마스터 전용 (2026-07-24).
// home(메인페이지)은 메뉴에 두지 않음 — 로그인 직후 첫 화면 + 로고(+SMORE OPS.) 클릭으로 진입 (2026-09-25 나츠).
export const ROLE_TABS: Record<Role, ScreenId[]> = {
  admin: ['board', 'stock', 'receipt', 'gacha', 'selfuse', 'transit', 'dispatch', 'queue', 'inbound', 'store-transfer', 'sales', 'items', 'accounts', 'wiki', 'guide'],
  hq: ['board', 'stock', 'receipt', 'gacha', 'selfuse', 'transit', 'dispatch', 'queue', 'inbound', 'store-transfer', 'sales', 'items', 'wiki', 'guide'],
  manager: ['board', 'stock', 'receipt', 'gacha', 'selfuse', 'store-transfer', 'wiki', 'guide'],
  warehouse: ['queue', 'inbound', 'stock', 'guide'],
};

// 메뉴에 없지만 전 역할이 들어갈 수 있는 화면 (홈, 홈에서 여는 공지사항·운영매뉴얼)
export const COMMON_SCREENS: ScreenId[] = ['home', 'notices', 'manuals'];

// 화면 이동 함수 (shell 이 내려줌).
// noticeId: 공지사항 화면에서 그 공지를 펼친 채로 / manualId·category: 운영매뉴얼 화면에서 그 문서·카테고리로
export type GoOpts = { noticeId?: string; manualId?: string; category?: string };
export type GoFn = (screen: ScreenId, opts?: GoOpts) => void;

export const ROLES: Role[] = ['admin', 'hq', 'manager', 'warehouse'];
