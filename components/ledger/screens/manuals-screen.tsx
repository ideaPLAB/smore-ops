'use client';

// 운영매뉴얼 — 홈 매뉴얼 칸에서 진입 (메뉴에는 없음, 공지사항과 같은 방식)
// 조회: 전 역할 / 작성·수정·삭제: 본사·마스터 (RPC 에서 한 번 더 확인)
// 카테고리 6종 탭 → 문서 목록 → 문서 보기. 본문은 Tiptap(표·이미지·목록).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRole } from '../role-context';
import { ManualEditor, ManualViewer } from '../manual-editor';
import {
  listManuals, saveManual, deleteManual, uploadManualImage, removeManualImages, imageUrlsIn, isEmptyDoc,
  MANUAL_CATEGORIES, ManualCategory, ManualRow, DocNode,
} from '@/lib/ledger/manuals';
import { fmtNoticeDate } from '@/lib/ledger/notices';

type Draft = {
  id: string | null;
  category: ManualCategory;
  title: string;
  sortOrder: number;
  initial: DocNode | null; // 에디터 첫 내용 (수정 시 기존 문서)
  originalImages: string[]; // 수정 전 문서에 있던 이미지 (저장 후 빠진 것 정리)
};

function errText(e: unknown) {
  return (e as Error)?.message ?? String(e);
}

export function ManualsScreen({ initialOpenId, initialCategory }: { initialOpenId: string | null; initialCategory: string | null }) {
  const { role, session } = useRole();
  const canWrite = role === 'admin' || role === 'hq';

  const [rows, setRows] = useState<ManualRow[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [cat, setCat] = useState<ManualCategory | null>(
    MANUAL_CATEGORIES.includes(initialCategory as ManualCategory) ? (initialCategory as ManualCategory) : null,
  );
  const [openId, setOpenId] = useState<string | null>(initialOpenId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  // 에디터 현재 내용·이번 편집에서 올린 이미지 — 입력마다 리렌더할 필요 없어 ref 로 보관
  const docRef = useRef<DocNode | null>(null);
  const uploadedRef = useRef<string[]>([]);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  }

  async function reload() {
    try {
      setRows(await listManuals());
      setLoadErr('');
    } catch (e) {
      setLoadErr(errText(e));
    }
  }

  useEffect(() => {
    reload();
  }, []);

  // 문서 열기·목록으로 돌아가기 때 맨 위로
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [openId]);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows ?? []) m[r.category] = (m[r.category] ?? 0) + 1;
    return m;
  }, [rows]);

  const open = rows?.find((r) => r.id === openId) ?? null;
  const shown = (rows ?? []).filter((r) => !cat || r.category === cat);

  function beginDraft(d: Draft) {
    docRef.current = d.initial;
    uploadedRef.current = [];
    setDraft(d);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startNew() {
    beginDraft({ id: null, category: cat ?? MANUAL_CATEGORIES[0], title: '', sortOrder: 0, initial: null, originalImages: [] });
  }

  function startEdit(m: ManualRow) {
    beginDraft({
      id: m.id, category: m.category, title: m.title, sortOrder: m.sort_order,
      initial: m.content, originalImages: imageUrlsIn(m.content),
    });
  }

  async function cancelDraft() {
    if (!draft) return;
    const dirty = draft.title.trim() || !isEmptyDoc(docRef.current) || uploadedRef.current.length;
    if (dirty && !window.confirm('작성 중인 내용이 저장되지 않고 사라집니다. 취소할까요?')) return;
    await removeManualImages(uploadedRef.current); // 저장 안 한 이미지 정리
    uploadedRef.current = [];
    setDraft(null);
  }

  async function handleSave() {
    if (!draft || !session) return;
    const doc = docRef.current ?? { type: 'doc', content: [] };
    if (isEmptyDoc(doc) && !window.confirm('본문이 비어 있습니다. 이대로 저장할까요?')) return;
    setSaving(true);
    try {
      const id = await saveManual(session.id, {
        id: draft.id,
        category: draft.category,
        title: draft.title.trim(),
        content: doc,
        sortOrder: Number.isFinite(draft.sortOrder) ? Math.trunc(draft.sortOrder) : 0,
      });
      // 저장된 문서에 없는 이미지(수정 중 뺀 기존 이미지 + 올렸다가 지운 이미지) 정리
      const kept = new Set(imageUrlsIn(doc));
      await removeManualImages([...draft.originalImages, ...uploadedRef.current].filter((u) => !kept.has(u)));
      uploadedRef.current = [];
      setDraft(null);
      setCat(draft.category);
      setOpenId(id);
      await reload();
      flash(draft.id ? '매뉴얼을 수정했습니다' : '매뉴얼을 등록했습니다');
    } catch (e) {
      flash(`저장 실패: ${errText(e)}`); // 에디터는 그대로 두어 다시 저장 가능
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(m: ManualRow) {
    if (!session || !window.confirm(`"${m.title}" 매뉴얼을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteManual(session.id, m.id);
      await removeManualImages(imageUrlsIn(m.content));
      setOpenId(null);
      await reload();
      flash('매뉴얼을 삭제했습니다');
    } catch (e) {
      flash(`삭제 실패: ${errText(e)}`);
    }
  }

  // ── 작성·수정 화면 ─────────────────────────────────────
  if (draft) {
    return (
      <div className="mn-wrap">
        <div className="lg-form-card nt-editor">
          <p className="nt-editor-h">{draft.id ? '매뉴얼 수정' : '새 매뉴얼 작성'}</p>

          <div className="mn-form-row">
            <div className="mn-form-cat">
              <label className="lg-label" htmlFor="mn-cat">카테고리</label>
              <select
                id="mn-cat"
                className="lg-input nt-field"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value as ManualCategory })}
              >
                {MANUAL_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="mn-form-sort">
              <label className="lg-label" htmlFor="mn-sort">순서</label>
              <input
                id="mn-sort"
                type="number"
                className="lg-input nt-field"
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                title="작을수록 목록 위에 표시 (같으면 최근 수정순)"
              />
            </div>
          </div>

          <label className="lg-label" htmlFor="mn-title">제목</label>
          <input
            id="mn-title"
            className="lg-input nt-field"
            value={draft.title}
            maxLength={120}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="매뉴얼 제목"
          />

          <label className="lg-label">내용</label>
          <ManualEditor
            key={draft.id ?? 'new'}
            initial={draft.initial}
            onChange={(d) => { docRef.current = d; }}
            uploadImage={uploadManualImage}
            onUploaded={(u) => { uploadedRef.current = [...uploadedRef.current, u]; }}
            onError={flash}
          />
          <p className="mn-hint">이미지는 🖼 버튼, 붙여넣기, 끌어다 놓기 모두 됩니다 (10MB 이하). 표 안에 커서를 두면 행·열 편집 버튼이 나옵니다.</p>

          <div className="nt-editor-btns">
            <button type="button" className="lg-btn-secondary" onClick={cancelDraft} disabled={saving}>
              취소
            </button>
            <button type="button" className="lg-btn-main nt-save" onClick={handleSave} disabled={saving || !draft.title.trim()}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
        {toast && <div className="lg-toast">{toast}</div>}
      </div>
    );
  }

  // ── 목록 / 보기 ───────────────────────────────────────
  return (
    <div className="mn-wrap">
      <div className="mn-top">
        <div className="mn-cats" role="tablist" aria-label="카테고리">
          <button type="button" role="tab" aria-selected={!cat} className={`mn-cat${!cat ? ' on' : ''}`} onClick={() => { setCat(null); setOpenId(null); }}>
            전체 <span className="mn-cnt">{rows?.length ?? 0}</span>
          </button>
          {MANUAL_CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" aria-selected={cat === c} className={`mn-cat${cat === c ? ' on' : ''}`} onClick={() => { setCat(c); setOpenId(null); }}>
              {c} <span className="mn-cnt">{counts[c] ?? 0}</span>
            </button>
          ))}
        </div>
        {canWrite && (
          <button type="button" className="lg-btn-ghost mn-new" onClick={startNew}>
            + 새 매뉴얼
          </button>
        )}
      </div>

      {loadErr ? (
        <div className="lg-card hm-empty">매뉴얼을 불러오지 못했습니다. ({loadErr})</div>
      ) : rows === null ? (
        <div className="lg-card hm-empty">불러오는 중…</div>
      ) : open ? (
        <article className="lg-card mn-doc">
          <button type="button" className="hm-more mn-back" onClick={() => setOpenId(null)}>‹ 목록으로</button>
          <p className="mn-doc-cat">{open.category}</p>
          <h2 className="mn-doc-t">{open.title}</h2>
          <p className="nt-meta">
            {open.author_name ?? '—'} · 작성 {fmtNoticeDate(open.created_at)}
            {open.updated_at !== open.created_at && ` · 최종 수정 ${fmtNoticeDate(open.updated_at, true)}`}
          </p>
          {isEmptyDoc(open.content) ? <p className="hm-empty">내용이 없습니다.</p> : <ManualViewer doc={open.content} />}
          {canWrite && (
            <div className="nt-actions mn-doc-actions">
              <button type="button" className="lg-btn-ghost" onClick={() => startEdit(open)}>수정</button>
              <button type="button" className="lg-btn-ghost nt-del" onClick={() => handleDelete(open)}>삭제</button>
            </div>
          )}
        </article>
      ) : shown.length === 0 ? (
        <div className="lg-card hm-empty">{cat ? `'${cat}' 매뉴얼이 아직 없습니다.` : '등록된 매뉴얼이 없습니다.'}</div>
      ) : (
        <div className="lg-card nt-list">
          {shown.map((m, i) => (
            <div key={m.id}>
              {!cat && (i === 0 || shown[i - 1].category !== m.category) && <p className="mn-group">{m.category}</p>}
              <button type="button" className="nt-head mn-row" onClick={() => setOpenId(m.id)}>
                <span className="nt-title">{m.title}</span>
                <span className="nt-date">{fmtNoticeDate(m.updated_at)}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && <div className="lg-toast">{toast}</div>}
    </div>
  );
}
