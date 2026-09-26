// 공지사항 조회·작성 (schema_patch_v0_36).
// 조회는 테이블 직접 SELECT, 쓰기는 RPC 경유 — RPC 안에서 본사·마스터만 허용.
// 본문은 Tiptap 문서(content, schema_patch_v0_37) — 이미지도 본문 안에 (rich-doc.ts, ops-content 버킷 notices/).
// 옛 공지(v0_37 이전)는 content 가 비어 있고 body 텍스트 + image_paths(첨부 이미지 경로)로 표시.
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';
import type { DocNode } from './rich-doc';

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  image_paths: string[];
  content: DocNode;
  pinned: boolean;
  author_name: string | null;
  created_at: string;
  updated_at: string;
}

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new SupabaseMissingError();
  return sb;
}

// 고정 공지 먼저, 그다음 최신순
export async function listNotices(limit?: number): Promise<NoticeRow[]> {
  let q = client()
    .from('notices')
    .select('id,title,body,image_paths,content,pinned,author_name,created_at,updated_at')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as NoticeRow[];
}

export async function saveNotice(
  actorId: string,
  input: { id: string | null; title: string; body: string; imagePaths: string[]; pinned: boolean; content: DocNode },
): Promise<string> {
  const { data, error } = await client().rpc('app_save_notice', {
    p_actor: actorId,
    p_id: input.id,
    p_title: input.title,
    p_body: input.body,
    p_image_paths: input.imagePaths,
    p_pinned: input.pinned,
    p_content: input.content,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteNotice(actorId: string, id: string): Promise<void> {
  const { error } = await client().rpc('app_delete_notice', { p_actor: actorId, p_id: id });
  if (error) throw error;
}

// 표시용 날짜
export function fmtNoticeDate(iso: string, withTime = false): string {
  const d = new Date(iso);
  const ymd = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  if (!withTime) return ymd;
  return `${ymd} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 3일 이내 작성 = 새 공지
export function isNewNotice(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 3 * 24 * 60 * 60 * 1000;
}
