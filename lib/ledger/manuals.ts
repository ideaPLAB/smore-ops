// 운영매뉴얼 조회·작성 (schema_patch_v0_36, 메인페이지 Phase 3).
// 조회는 테이블 직접 SELECT, 쓰기는 RPC 경유 — RPC 안에서 본사·마스터만 허용.
// 본문은 Tiptap 문서 JSON(content). 본문 이미지는 'ops-content' 버킷 manuals/ 아래에 올리고
// 문서 안에는 공개 URL 을 그대로 넣는다 → 정리할 때는 URL 에서 버킷 경로를 되찾아 지운다.
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';

const BUCKET = 'ops-content';
export const MANUAL_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 버킷 제한과 동일
export const MANUAL_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';

// DB check 제약과 같은 순서·표기 (2026-09-18 나츠 확정 6종)
export const MANUAL_CATEGORIES = ['매장 운영', '발주 절차', '재고 관리', '클레임 대응', '기기 AS 관련', 'F&B 매뉴얼'] as const;
export type ManualCategory = (typeof MANUAL_CATEGORIES)[number];

// Tiptap JSON 노드 (필요한 만큼만 타입 지정)
export interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  [k: string]: unknown;
}

export interface ManualRow {
  id: string;
  category: ManualCategory;
  title: string;
  content: DocNode;
  sort_order: number;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new SupabaseMissingError();
  return sb;
}

// 카테고리 순서 → 정렬 순서(작은 값 먼저) → 최근 수정순
export async function listManuals(): Promise<ManualRow[]> {
  const { data, error } = await client()
    .from('manuals')
    .select('id,category,title,content,sort_order,author_name,created_at,updated_at')
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as ManualRow[];
  const rank = (c: string) => MANUAL_CATEGORIES.indexOf(c as ManualCategory);
  return rows.sort((a, b) => rank(a.category) - rank(b.category));
}

// 홈 칸용 — 본문 없이 최근 수정순
export async function listRecentManuals(limit: number): Promise<Pick<ManualRow, 'id' | 'category' | 'title' | 'updated_at'>[]> {
  const { data, error } = await client()
    .from('manuals')
    .select('id,category,title,updated_at')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Pick<ManualRow, 'id' | 'category' | 'title' | 'updated_at'>[];
}

export async function countManualsByCategory(): Promise<Record<string, number>> {
  const { data, error } = await client().from('manuals').select('category');
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { category: string }[]) out[r.category] = (out[r.category] ?? 0) + 1;
  return out;
}

export async function uploadManualImage(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `manuals/${crypto.randomUUID()}.${ext}`;
  const sb = client();
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// 공개 URL → 버킷 안 경로 (우리 버킷 manuals/ 이미지가 아니면 null — 외부 URL 은 건드리지 않음)
function urlToPath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  return path.startsWith('manuals/') ? path : null;
}

// 문서 안 이미지 URL 전부
export function imageUrlsIn(doc: DocNode | null | undefined): string[] {
  const out: string[] = [];
  const walk = (n: DocNode) => {
    if (n.type === 'image' && typeof n.attrs?.src === 'string') out.push(n.attrs.src);
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
}

// 이미지 정리는 실패해도 매뉴얼 저장/삭제 자체는 성공으로 둔다 (고아 파일만 남음)
export async function removeManualImages(urls: string[]): Promise<void> {
  const paths = Array.from(new Set(urls.map(urlToPath).filter((p): p is string => !!p)));
  if (paths.length === 0) return;
  try {
    await client().storage.from(BUCKET).remove(paths);
  } catch {
    /* noop */
  }
}

export async function saveManual(
  actorId: string,
  input: { id: string | null; category: ManualCategory; title: string; content: DocNode; sortOrder: number },
): Promise<string> {
  const { data, error } = await client().rpc('app_save_manual', {
    p_actor: actorId,
    p_id: input.id,
    p_category: input.category,
    p_title: input.title,
    p_content: input.content,
    p_sort_order: input.sortOrder,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteManual(actorId: string, id: string): Promise<void> {
  const { error } = await client().rpc('app_delete_manual', { p_actor: actorId, p_id: id });
  if (error) throw error;
}

// 빈 문서 여부 (글자·이미지·표 하나도 없음)
export function isEmptyDoc(doc: DocNode | null | undefined): boolean {
  let has = false;
  const walk = (n: DocNode) => {
    if (has) return;
    if ((n.type === 'text' && n.text?.trim()) || n.type === 'image' || n.type === 'table' || n.type === 'horizontalRule') has = true;
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return !has;
}
