'use client';

// 공지사항 전체보기 — 홈 공지 칸의 "더보기"/공지 제목 클릭으로 진입 (메뉴에는 없음)
// 조회: 전 역할 / 작성·수정·삭제·고정: 본사·마스터 (RPC 에서 한 번 더 확인)

import { useEffect, useState, ChangeEvent } from 'react';
import { useRole } from '../role-context';
import {
  listNotices, saveNotice, deleteNotice, uploadNoticeImage, removeNoticeImages, noticeImageUrl,
  fmtNoticeDate, isNewNotice, NoticeRow, NOTICE_IMAGE_ACCEPT, NOTICE_IMAGE_MAX_BYTES,
} from '@/lib/ledger/notices';

type Draft = {
  id: string | null;
  title: string;
  body: string;
  pinned: boolean;
  keptPaths: string[]; // 수정 시 그대로 둘 기존 이미지
  removedPaths: string[]; // 수정 시 빼기로 한 기존 이미지 (저장 성공 후 storage 에서 삭제)
  newFiles: File[]; // 새로 붙인 이미지 (저장할 때 업로드)
};

const EMPTY_DRAFT: Draft = { id: null, title: '', body: '', pinned: false, keptPaths: [], removedPaths: [], newFiles: [] };

function errText(e: unknown) {
  return (e as Error)?.message ?? String(e);
}

// 새로 붙인 파일 미리보기 — objectURL 은 한 번만 만들고 사라질 때 해제
function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" /> : null;
}

function NoticeEditor({ draft, setDraft, saving, onSave, onCancel }: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [fileErr, setFileErr] = useState('');

  function addFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    const tooBig = files.filter((f) => f.size > NOTICE_IMAGE_MAX_BYTES);
    setFileErr(tooBig.length ? `10MB가 넘는 이미지는 올릴 수 없습니다: ${tooBig.map((f) => f.name).join(', ')}` : '');
    const ok = files.filter((f) => f.size <= NOTICE_IMAGE_MAX_BYTES);
    if (ok.length) setDraft({ ...draft, newFiles: [...draft.newFiles, ...ok] });
  }

  return (
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

      <label className="lg-label" htmlFor="nt-body">내용</label>
      <textarea
        id="nt-body"
        className="lg-input nt-field nt-textarea"
        value={draft.body}
        onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        placeholder="공지 내용 (줄바꿈 그대로 표시됩니다)"
      />

      <label className="lg-label">이미지</label>
      <div className="nt-thumbs">
        {draft.keptPaths.map((p) => (
          <div key={p} className="nt-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={noticeImageUrl(p)} alt="" />
            <button
              type="button"
              aria-label="이미지 빼기"
              onClick={() => setDraft({
                ...draft,
                keptPaths: draft.keptPaths.filter((x) => x !== p),
                removedPaths: [...draft.removedPaths, p],
              })}
            >
              ×
            </button>
          </div>
        ))}
        {draft.newFiles.map((f, i) => (
          <div key={`${f.name}-${i}`} className="nt-thumb">
            <FilePreview file={f} />
            <button
              type="button"
              aria-label="이미지 빼기"
              onClick={() => setDraft({ ...draft, newFiles: draft.newFiles.filter((_, j) => j !== i) })}
            >
              ×
            </button>
          </div>
        ))}
        <label className="nt-thumb nt-add">
          + 추가
          <input type="file" accept={NOTICE_IMAGE_ACCEPT} multiple onChange={addFiles} hidden />
        </label>
      </div>
      {fileErr && <p className="nt-err">{fileErr}</p>}

      <label className="nt-check">
        <input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} />
        중요 공지로 상단 고정
      </label>

      <div className="nt-editor-btns">
        <button type="button" className="lg-btn-secondary" onClick={onCancel} disabled={saving}>
          취소
        </button>
        <button type="button" className="lg-btn-main nt-save" onClick={onSave} disabled={saving || !draft.title.trim()}>
          {saving ? '저장 중…' : '저장'}
        </button>
      </div>
    </div>
  );
}

export function NoticesScreen({ initialOpenId }: { initialOpenId: string | null }) {
  const { role, session } = useRole();
  const canWrite = role === 'admin' || role === 'hq';

  const [rows, setRows] = useState<NoticeRow[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

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
  }, []);

  function startEdit(n: NoticeRow) {
    setDraft({ id: n.id, title: n.title, body: n.body, pinned: n.pinned, keptPaths: [...n.image_paths], removedPaths: [], newFiles: [] });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSave() {
    if (!draft || !session) return;
    setSaving(true);
    const uploaded: string[] = [];
    try {
      for (const f of draft.newFiles) uploaded.push(await uploadNoticeImage(f));
      const id = await saveNotice(session.id, {
        id: draft.id,
        title: draft.title.trim(),
        body: draft.body,
        imagePaths: [...draft.keptPaths, ...uploaded],
        pinned: draft.pinned,
      });
      await removeNoticeImages(draft.removedPaths);
      setDraft(null);
      setOpenId(id);
      await reload();
      flash(draft.id ? '공지를 수정했습니다' : '공지를 등록했습니다');
    } catch (e) {
      await removeNoticeImages(uploaded); // 저장 실패 시 방금 올린 이미지 정리
      flash(`저장 실패: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(n: NoticeRow) {
    if (!session || !window.confirm(`"${n.title}" 공지를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteNotice(session.id, n.id);
      await removeNoticeImages(n.image_paths);
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
      await saveNotice(session.id, { id: n.id, title: n.title, body: n.body, imagePaths: n.image_paths, pinned: !n.pinned });
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
          <button type="button" className="lg-btn-ghost" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            + 새 공지
          </button>
        </div>
      )}

      {draft && (
        <NoticeEditor draft={draft} setDraft={setDraft} saving={saving} onSave={handleSave} onCancel={() => setDraft(null)} />
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
                    {n.body && <p className="nt-text">{n.body}</p>}
                    {n.image_paths.length > 0 && (
                      <div className="nt-images">
                        {n.image_paths.map((p) => (
                          <a key={p} href={noticeImageUrl(p)} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={noticeImageUrl(p)} alt="" />
                          </a>
                        ))}
                      </div>
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
