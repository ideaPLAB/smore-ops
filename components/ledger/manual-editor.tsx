'use client';

// 운영매뉴얼 Rich Text — Tiptap v3 (메인페이지 Phase 3)
// ManualEditor: 본사·마스터 작성/수정용 (툴바: 제목·굵게·목록·표·이미지·링크 등)
// ManualViewer: 전 역할 조회용 (같은 확장으로 읽기 전용 렌더 → 작성 화면과 보기 화면 모양이 같음)

import { useRef, useState, ChangeEvent } from 'react';
import { useEditor, useEditorState, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { MANUAL_IMAGE_ACCEPT, MANUAL_IMAGE_MAX_BYTES, DocNode } from '@/lib/ledger/manuals';

function extensions(editable: boolean) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      codeBlock: false,
      code: false,
      link: { openOnClick: !editable, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noreferrer' } },
    }),
    Image.configure({ allowBase64: false }),
    TableKit.configure({ table: { resizable: false } }),
    ...(editable ? [Placeholder.configure({ placeholder: '내용을 입력하세요' })] : []),
  ];
}

function isImageFile(f: File) {
  return f.type.startsWith('image/');
}

function ToolBtn({ on, disabled, title, onClick, children }: {
  on?: boolean; disabled?: boolean; title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`mn-tool${on ? ' on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      // mousedown 기본동작을 막아야 에디터 선택 영역이 유지됨
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor, uploading, onPickImage }: { editor: Editor; uploading: boolean; onPickImage: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      link: e.isActive('link'),
      inTable: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const c = () => editor.chain().focus();

  function setLink() {
    const prev = (editor.getAttributes('link').href as string | undefined) ?? '';
    const url = window.prompt('링크 주소 (비우면 링크 해제)', prev || 'https://');
    if (url === null) return;
    const v = url.trim();
    if (!v || v === 'https://') c().extendMarkRange('link').unsetLink().run();
    else c().extendMarkRange('link').setLink({ href: /^https?:\/\//.test(v) ? v : `https://${v}` }).run();
  }

  return (
    <div className="mn-toolbar" role="toolbar" aria-label="서식">
      <ToolBtn title="큰 제목" on={s.h2} onClick={() => c().toggleHeading({ level: 2 }).run()}>제목</ToolBtn>
      <ToolBtn title="작은 제목" on={s.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>소제목</ToolBtn>
      <span className="mn-sep" />
      <ToolBtn title="굵게" on={s.bold} onClick={() => c().toggleBold().run()}><b>B</b></ToolBtn>
      <ToolBtn title="기울임" on={s.italic} onClick={() => c().toggleItalic().run()}><i>I</i></ToolBtn>
      <ToolBtn title="밑줄" on={s.underline} onClick={() => c().toggleUnderline().run()}><u>U</u></ToolBtn>
      <ToolBtn title="취소선" on={s.strike} onClick={() => c().toggleStrike().run()}><s>S</s></ToolBtn>
      <span className="mn-sep" />
      <ToolBtn title="글머리 목록" on={s.bullet} onClick={() => c().toggleBulletList().run()}>• 목록</ToolBtn>
      <ToolBtn title="번호 목록" on={s.ordered} onClick={() => c().toggleOrderedList().run()}>1. 목록</ToolBtn>
      <ToolBtn title="강조 박스(인용)" on={s.quote} onClick={() => c().toggleBlockquote().run()}>❝ 강조</ToolBtn>
      <ToolBtn title="구분선" onClick={() => c().setHorizontalRule().run()}>― 구분선</ToolBtn>
      <span className="mn-sep" />
      <ToolBtn title="링크" on={s.link} onClick={setLink}>🔗 링크</ToolBtn>
      <ToolBtn title="이미지 넣기" disabled={uploading} onClick={onPickImage}>{uploading ? '올리는 중…' : '🖼 이미지'}</ToolBtn>
      <ToolBtn title="표 넣기 (3×3)" disabled={s.inTable} onClick={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>▦ 표</ToolBtn>
      <span className="mn-sep" />
      <ToolBtn title="되돌리기" disabled={!s.canUndo} onClick={() => c().undo().run()}>↶</ToolBtn>
      <ToolBtn title="다시하기" disabled={!s.canRedo} onClick={() => c().redo().run()}>↷</ToolBtn>

      {s.inTable && (
        <div className="mn-toolbar-sub">
          <span className="mn-sub-label">표</span>
          <ToolBtn title="아래에 행 추가" onClick={() => c().addRowAfter().run()}>+ 행</ToolBtn>
          <ToolBtn title="오른쪽에 열 추가" onClick={() => c().addColumnAfter().run()}>+ 열</ToolBtn>
          <ToolBtn title="이 행 삭제" onClick={() => c().deleteRow().run()}>− 행</ToolBtn>
          <ToolBtn title="이 열 삭제" onClick={() => c().deleteColumn().run()}>− 열</ToolBtn>
          <ToolBtn title="첫 행 머리글 켜기/끄기" onClick={() => c().toggleHeaderRow().run()}>머리글</ToolBtn>
          <ToolBtn title="셀 합치기/나누기" onClick={() => c().mergeOrSplit().run()}>합치기</ToolBtn>
          <ToolBtn title="표 삭제" onClick={() => c().deleteTable().run()}>표 삭제</ToolBtn>
        </div>
      )}
    </div>
  );
}

// 작성·수정 에디터. 이미지는 고르는 즉시 업로드해 공개 URL 로 삽입하고, 올린 URL 은 onUploaded 로 알린다
// (저장 안 하고 취소하면 부모가 그 파일들을 정리).
export function ManualEditor({ initial, onChange, uploadImage, onUploaded, onError }: {
  initial: DocNode | null;
  onChange: (doc: DocNode) => void;
  uploadImage: (f: File) => Promise<string>;
  onUploaded: (url: string) => void;
  onError: (msg: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const editorRef = useRef<Editor | null>(null);

  async function insertFiles(files: File[], pos?: number) {
    const ed = editorRef.current;
    if (!ed) return;
    const imgs = files.filter(isImageFile);
    const tooBig = imgs.filter((f) => f.size > MANUAL_IMAGE_MAX_BYTES);
    if (tooBig.length) onError(`10MB가 넘는 이미지는 올릴 수 없습니다: ${tooBig.map((f) => f.name).join(', ')}`);
    const ok = imgs.filter((f) => f.size <= MANUAL_IMAGE_MAX_BYTES);
    if (!ok.length) return;
    setUploading(true);
    try {
      for (const f of ok) {
        const url = await uploadImage(f);
        onUploaded(url);
        const node = { type: 'image', attrs: { src: url, alt: f.name } };
        if (pos != null) ed.chain().focus().insertContentAt(pos, node).run();
        else ed.chain().focus().insertContent(node).run();
      }
    } catch (e) {
      onError(`이미지 업로드 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setUploading(false);
    }
  }

  const editor = useEditor({
    extensions: extensions(true),
    content: initial && initial.type ? initial : '',
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'mn-prose mn-prose-edit' },
      // 이미지 붙여넣기·끌어다 놓기 → 업로드 후 삽입
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
        if (!files.length) return false;
        event.preventDefault();
        insertFiles(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false;
        const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertFiles(files, at);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => onChange(e.getJSON() as DocNode),
  });
  editorRef.current = editor;

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    insertFiles(files);
  }

  if (!editor) return <div className="mn-editor-box"><p className="hm-empty">에디터 준비 중…</p></div>;

  return (
    <div className="mn-editor-box">
      <Toolbar editor={editor} uploading={uploading} onPickImage={() => fileRef.current?.click()} />
      <EditorContent editor={editor} />
      <input ref={fileRef} type="file" accept={MANUAL_IMAGE_ACCEPT} multiple hidden onChange={pick} />
    </div>
  );
}

// 읽기 전용 보기
export function ManualViewer({ doc }: { doc: DocNode }) {
  const editor = useEditor(
    {
      extensions: extensions(false),
      content: doc && doc.type ? doc : '',
      editable: false,
      immediatelyRender: false,
      editorProps: { attributes: { class: 'mn-prose' } },
    },
    [doc],
  );
  if (!editor) return null;
  return <EditorContent editor={editor} />;
}
