// Tiptap 문서(JSON) 공통 도우미 — 운영매뉴얼·공지사항 본문 (메인페이지 Phase 3)
// 본문 이미지는 'ops-content' 버킷 <folder>/ 아래에 올리고 문서 안에는 공개 URL 을 넣는다.
// 정리할 때는 URL 에서 버킷 경로를 되찾아 지운다 (우리 버킷 manuals/·notices/ 이미지만).
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';

const BUCKET = 'ops-content';
const FOLDERS = ['manuals/', 'notices/'];
export const CONTENT_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 버킷 제한과 동일
export const CONTENT_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';

// Tiptap JSON 노드 (필요한 만큼만 타입 지정)
export interface DocNode {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  [k: string]: unknown;
}

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new SupabaseMissingError();
  return sb;
}

export function contentImageUrl(path: string): string {
  return client().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function uploadContentImage(folder: 'manuals' | 'notices', file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;
  const { error } = await client().storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  return contentImageUrl(path);
}

// 공개 URL → 버킷 안 경로 (우리 버킷 이미지가 아니면 null — 외부 URL 은 건드리지 않음)
function urlToPath(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i < 0) return null;
  const path = decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  return FOLDERS.some((f) => path.startsWith(f)) ? path : null;
}

// 이미지 정리는 실패해도 저장/삭제 자체는 성공으로 둔다 (고아 파일만 남음)
export async function removeContentImages(urls: string[]): Promise<void> {
  const paths = Array.from(new Set(urls.map(urlToPath).filter((p): p is string => !!p)));
  if (paths.length === 0) return;
  try {
    await client().storage.from(BUCKET).remove(paths);
  } catch {
    /* noop */
  }
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

// Tiptap 문서인지 (공지 옛 글은 content 가 {} → false)
export function isDoc(doc: DocNode | null | undefined): doc is DocNode {
  return !!doc && doc.type === 'doc';
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

// 문서 → 줄글 (블록마다 줄바꿈). 공지 body(요약·검색용)에 저장
const BLOCKS = new Set(['paragraph', 'heading', 'listItem', 'blockquote', 'tableRow', 'horizontalRule']);
export function docToText(doc: DocNode | null | undefined): string {
  let out = '';
  const walk = (n: DocNode) => {
    if (n.type === 'text') out += n.text ?? '';
    else if (n.type === 'hardBreak') out += '\n';
    else if (n.type === 'tableCell' || n.type === 'tableHeader') {
      n.content?.forEach(walk);
      out += '\t';
      return;
    }
    n.content?.forEach(walk);
    if (n.type && BLOCKS.has(n.type) && !out.endsWith('\n')) out += '\n';
  };
  if (doc) walk(doc);
  return out.replace(/\t\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// 줄글 + 첨부 이미지(옛 공지) → 문서. 옛 공지를 새 에디터로 수정할 때 사용
export function textToDoc(text: string, imageUrls: string[] = []): DocNode {
  const paras: DocNode[] = text.split('\n').map((line) =>
    line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' });
  const imgs: DocNode[] = imageUrls.map((src) => ({ type: 'image', attrs: { src } }));
  return { type: 'doc', content: [...(text ? paras : []), ...imgs] };
}
