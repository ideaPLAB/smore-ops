// 공지사항 조회·작성 (schema_patch_v0_36).
// 조회는 테이블 직접 SELECT, 쓰기는 RPC 경유 — RPC 안에서 본사·마스터만 허용.
// 이미지는 storage 'ops-content' 버킷의 notices/ 아래에 저장, 경로만 image_paths 에 보관.
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';

const BUCKET = 'ops-content';
export const NOTICE_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 버킷 제한과 동일
export const NOTICE_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';

export interface NoticeRow {
  id: string;
  title: string;
  body: string;
  image_paths: string[];
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
    .select('id,title,body,image_paths,pinned,author_name,created_at,updated_at')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as NoticeRow[];
}

export function noticeImageUrl(path: string): string {
  return client().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadNoticeImage(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `notices/${crypto.randomUUID()}.${ext}`;
  const { error } = await client().storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

// 이미지 정리는 실패해도 공지 저장/삭제 자체는 성공으로 둔다 (고아 파일만 남음)
export async function removeNoticeImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    await client().storage.from(BUCKET).remove(paths);
  } catch {
    /* noop */
  }
}

export async function saveNotice(
  actorId: string,
  input: { id: string | null; title: string; body: string; imagePaths: string[]; pinned: boolean },
): Promise<string> {
  const { data, error } = await client().rpc('app_save_notice', {
    p_actor: actorId,
    p_id: input.id,
    p_title: input.title,
    p_body: input.body,
    p_image_paths: input.imagePaths,
    p_pinned: input.pinned,
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
