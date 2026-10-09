'use client';

// 공지사항 전체보기 — 홈 공지 칸의 "더보기"/공지 제목 클릭으로 진입 (메뉴에는 없음)
// 조회: 전 역할 / 작성·수정·삭제·고정: 본사·마스터 (RPC 에서 한 번 더 확인)

import { useEffect, useRef, useState } from 'react';
import { useRole } from '../role-context';
import { RichEditor, RichViewer } from '../rich-editor';
import { listNotices, saveNotice, deleteNotice, fmtNoticeDate, isNewNotice, NoticeRow } from '@/lib/ledger/notices';
import { listRecentManuals } from '@/lib/ledger/manuals';
import type { GoFn } from '@/lib/ledger/roles';
import {
  uploadContentImage, removeContentImages, contentImageUrl, imageUrlsIn, isDoc, isEmptyDoc, docToText, textToDoc, DocNode,
} from '@/lib/ledger/rich-doc';

// 본문은 매뉴얼과 같은 에디터(표·이미지·목록). 에디터 내용·올린 이미지는 ref 로 보관 (입력마다 리렌더 불필요)
type Draft = {
  id: string | null;
  title: string;
  pinned: boolean;
  manualId: string | null; // 하단 '관련 매뉴얼' 바로가기
  initial: DocNode | null; // 에디터 첫 내용 (옛 공지는 body+첨부 이미지를 문서로 바꿔서)
  originalImages: string[]; // 수정 전 공지에 있던 이미지 URL (저장 후 빠진 것 정리)
};

const EMPTY_DRAFT: Draft = { id: null, title: '', pinned: false, manualId: null, initial: null, originalImages: [] };

type ManualOpt = { id: string; title: string; category: string };
const uploadNotice = (f: File) => uploadContentImage('notices', f);

function errText(e: unknown) {
  return (e as Error)?.message ?? String(e);
}

// 공지의 이미지 URL 전부 (본문 안 + 옛 첨부)
function noticeImages(n: NoticeRow): string[] {
  return [...imageUrlsIn(n.content), ...n.image_paths.map(contentImageUrl)];
}

export function NoticesScreen({ initialOpenId, go }: { initialOpenId: string | null; go: GoFn }) {
  const { role, session } = useRole();
  const canWrite = role === 'admin' || role === 'hq';

  const [rows, setRows] = useState<NoticeRow[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [manuals, setManuals] = useState<ManualOpt[]>([]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  }

  async function reload() {
    try {
      setRows(await listNotices());
      setLoadErr('');
    } catch (e) {
      setLoadErr(errText(e));
    }
  }

  useEffect(() => {
    reload();
    // 관련 매뉴얼 선택칸·바로가기 제목용
    listRecentManuals(500).then((m) => setManuals(m as ManualOpt[])).catch(() => {});
  }, []);

  // 에디터 현재 내용·이번 편집에서 올린 이미지
  const docRef = useRef<DocNode | null>(null);
  const uploadedRef = useRef<string[]>([]);

  function beginDraft(d: Draft) {
    docRef.current = d.initial;
    uploadedRef.current = [];
    setDraft(d);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startEdit(n: NoticeRow) {
    // 옛 공지(content 없음)는 본문 텍스트 + 첨부 이미지를 문서로 바꿔서 연다 → 저장하면 새 형식으로 전환
    const initial = isDoc(n.content) ? n.content : textToDoc(n.body, n.image_paths.map(contentImageUrl));
    beginDraft({ id: n.id, title: n.title, pinned: n.pinned, manualId: n.manual_id, initial, originalImages: noticeImages(n) });
  }

  async function cancelDraft() {
    if (!draft) return;
    const dirty = draft.title.trim() || !isEmptyDoc(docRef.current) || uploadedRef.current.length;
    if (dirty && !window.confirm('작성 중인 내용이 저장되지 않고 사라집니다. 취소할까요?')) return;
    await removeContentImages(uploadedRef.current); // 저장 안 한 이미지 정리
    uploadedRef.current = [];
    setDraft(null);
  }

  async function handleSave() {
    if (!draft || !session) return;
    const doc = docRef.current ?? { type: 'doc', content: [] };
    setSaving(true);
    try {
      const id = await saveNotice(session.id, {
        id: draft.id,
        title: draft.title.trim(),
        body: docToText(doc), // 목록·검색용 줄글
        imagePaths: [], // 이미지는 본문 안으로
        pinned: draft.pinned,
        content: doc,
        manualId: draft.manualId,
      });
      // 저장된 본문에 없는 이미지(수정 중 뺀 기존 이미지 + 올렸다가 지운 이미지) 정리
      const kept = new Set(imageUrlsIn(doc));
      await removeContentImages([...draft.originalImages, ...uploadedRef.current].filter((u) => !kept.has(u)));
      uploadedRef.current = [];
      setDraft(null);
      setOpenId(id);
      await reload();
      flash(draft.id ? '공지를 수정했습니다' : '공지를 등록했습니다');
    } catch (e) {
      flash(`저장 실패: ${errText(e)}`); // 에디터는 그대로 두어 다시 저장 가능
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(n: NoticeRow) {
    if (!session || !window.confirm(`"${n.title}" 공지를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteNotice(session.id, n.id);
      await removeContentImages(noticeImages(n));
      if (openId === n.id) setOpenId(null);
      await reload();
      flash('공지를 삭제했습니다');
    } catch (e) {
      flash(`삭제 실패: ${errText(e)}`);
    }
  }

  async function togglePin(n: NoticeRow) {
    if (!session) return;
    try {
      await saveNotice(session.id, {
        id: n.id, title: n.title, body: n.body, imagePaths: n.image_paths, pinned: !n.pinned, content: n.content, manualId: n.manual_id,
      });
      await reload();
      flash(n.pinned ? '고정을 해제했습니다' : '상단에 고정했습니다');
    } catch (e) {
      flash(`변경 실패: ${errText(e)}`);
    }
  }

  return (
    <div className="nt-wrap">
      {canWrite && !draft && (
        <div className="nt-top">
          <button type="button" className="lg-btn-ghost" onClick={() => beginDraft({ ...EMPTY_DRAFT })}>
            + 새 공지
          </button>
        </div>
      )}

      {draft && (
        <div className="lg-form-card nt-editor">
          <p className="nt-editor-h">{draft.id ? '공지 수정' : '새 공지 작성'}</p>

          <label className="lg-label" htmlFor="nt-title">제목</label>
          <input
            id="nt-title"
            className="lg-input nt-field"
            value={draft.title}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="공지 제목"
          />

          <label className="lg-label">내용</label>
          <RichEditor
            key={draft.id ?? 'new'}
            initial={draft.initial}
            onChange={(d) => { docRef.current = d; }}
            uploadImage={uploadNotice}
            onUploaded={(u) => { uploadedRef.current = [...uploadedRef.current, u]; }}
            onError={flash}
          />
          <p className="mn-hint">이미지는 🖼 버튼, 붙여넣기, 끌어다 놓기 모두 됩니다 (10MB 이하). 표 안에 커서를 두면 행·열 편집 버튼이 나옵니다.</p>

          <label className="lg-label" htmlFor="nt-manual">관련 매뉴얼 (선택)</label>
          <select
            id="nt-manual"
            className="lg-select nt-field"
            value={draft.manualId ?? ''}
            onChange={(e) => setDraft({ ...draft, manualId: e.target.value || null })}
          >
            <option value="">연결 안 함</option>
            {manuals.map((m) => <option key={m.id} value={m.id}>[{m.category}] {m.title}</option>)}
          </select>
          <p className="mn-hint">고르면 공지 맨 아래에 해당 운영매뉴얼로 바로 가는 버튼이 붙어요.</p>

          <label className="nt-check">
            <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
            중요 공지로 상단 고정
          </label>

          <div className="nt-editor-btns">
            <button type="button" className="lg-btn-secondary" onClick={cancelDraft} disabled={saving}>
              취소
            </button>
            <button type="button" className="lg-btn-main nt-save" onClick={handleSave} disabled={saving || !draft.title.trim()}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}

      {loadErr ? (
        <div className="lg-card hm-empty">공지를 불러오지 못했습니다. ({loadErr})</div>
      ) : rows === null ? (
        <div className="lg-card hm-empty">불러오는 중…</div>
      ) : rows.length === 0 ? (
        <div className="lg-card hm-empty">등록된 공지가 없습니다.</div>
      ) : (
        <div className="lg-card nt-list">
          {rows.map((n) => {
            const open = openId === n.id;
            return (
              <article key={n.id} className={`nt-item${open ? ' open' : ''}`}>
                <button type="button" className="nt-head" onClick={() => setOpenId(open ? null : n.id)} aria-expanded={open}>
                  {n.pinned && <span className="nt-pin">고정</span>}
                  <span className="nt-title">{n.title}</span>
                  {isNewNotice(n.created_at) && <span className="nt-new">N</span>}
                  <span className="nt-date">{fmtNoticeDate(n.created_at)}</span>
                </button>
                {open && (
                  <div className="nt-body">
                    <p className="nt-meta">
                      {n.author_name ?? '—'} · {fmtNoticeDate(n.created_at, true)}
                      {n.updated_at !== n.created_at && ` (수정 ${fmtNoticeDate(n.updated_at, true)})`}
                    </p>
                    {isDoc(n.content) ? (
                      <div className="nt-rich"><RichViewer doc={n.content} /></div>
                    ) : (
                      <>
                        {/* 옛 공지 (v0_37 이전): 줄글 + 첨부 이미지 */}
                        {n.body && <p className="nt-text">{n.body}</p>}
                        {n.image_paths.length > 0 && (
                          <div className="nt-images">
                            {n.image_paths.map((p) => (
                              <a key={p} href={contentImageUrl(p)} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={contentImageUrl(p)} alt="" />
                              </a>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {n.manual_id && (
                      <button
                        type="button"
                        className="lg-btn-main"
                        style={{ width: 'auto', height: 'auto', padding: '10px 16px', marginTop: 16, fontSize: '.88rem', textAlign: 'left' }}
                        onClick={() => go('manuals', { manualId: n.manual_id! })}
                      >
                        📖 매뉴얼 보기: {manuals.find((m) => m.id === n.manual_id)?.title ?? '관련 운영매뉴얼'}
                      </button>
                    )}
                    {canWrite && (
                      <div className="nt-actions">
                        <button type="button" className="lg-btn-ghost" onClick={() => startEdit(n)}>수정</button>
                        <button type="button" className="lg-btn-ghost" onClick={() => togglePin(n)}>
                          {n.pinned ? '고정 해제' : '상단 고정'}
                        </button>
                        <button type="button" className="lg-btn-ghost nt-del" onClick={() => handleDelete(n)}>삭제</button>
                      </div>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {toast && <div className="lg-toast">{toast}</div>}
    </div>
  );
}
