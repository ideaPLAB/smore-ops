// 운영매뉴얼 조회·작성 (schema_patch_v0_36, 메인페이지 Phase 3).
// 조회는 테이블 직접 SELECT, 쓰기는 RPC 경유 — RPC 안에서 본사·마스터만 허용.
// 본문은 Tiptap 문서 JSON(content). 이미지 업로드·정리는 rich-doc.ts (ops-content 버킷 manuals/).
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';
import type { DocNode } from './rich-doc';

// DB check 제약과 같은 순서·표기 (2026-09-18 나츠 확정 6종)
export const MANUAL_CATEGORIES = ['매장 운영', '발주 절차', '재고 관리', '클레임 대응', '기기 AS 관련', 'F&B 매뉴얼'] as const;
export type ManualCategory = (typeof MANUAL_CATEGORIES)[number];

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
