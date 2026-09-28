'use client';

// 캘린더 — 홈 캘린더 칸의 "전체보기"/일정 클릭으로 진입 (메뉴에는 없음, 공지·매뉴얼과 같은 방식)
// 월간 달력 + 이번 달(또는 고른 날) 일정 목록. 유형별 색: 입고/팝업/정산마감/기타
// 조회: 전 역할 / 등록·수정·삭제: 본사·마스터 (RPC 에서 한 번 더 확인)

import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { useRole } from '../role-context';
import { getLocations } from '@/lib/ledger/queries';
import type { LocationRow } from '@/lib/ledger/types';
import {
  listEvents, saveEvent, deleteEvent, monthCells, eventCovers, fmtEventRange, parseYmd, todayYmd,
  listEventTypes, saveEventType, deleteEventType, typeColor, EVENT_COLORS, DEFAULT_EVENT_TYPES,
  EventType, EventTypeRow, CalendarEvent,
} from '@/lib/ledger/calendar';

type Draft = {
  id: string | null;
  title: string;
  eventDate: string;
  multi: boolean; // 여러 날 일정
  endDate: string;
  eventType: EventType;
  locationId: string; // '' = 전체 매장
  memo: string;
};

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const MAX_CHIPS = 3;

function errText(e: unknown) {
  return (e as Error)?.message ?? String(e);
}

// 유형 색 → CSS 변수 (진한 색 + 옅은 배경)
export function typeStyle(color: string): CSSProperties {
  return { '--cal-c': color, '--cal-s': `${color}1a` } as CSSProperties;
}

export function EventTypeTag({ type, color }: { type: EventType; color: string }) {
  return <span className="cal-tag" style={typeStyle(color)}>{type}</span>;
}

// 유형 목록 (홈 칸·캘린더 화면 공용). 불러오기 실패 시 기본 4종
export function useEventTypes() {
  const [types, setTypes] = useState<EventTypeRow[]>(DEFAULT_EVENT_TYPES);
  const [fromDb, setFromDb] = useState(false);
  async function reloadTypes() {
    try {
      const r = await listEventTypes();
      setTypes(r.types.length ? r.types : DEFAULT_EVENT_TYPES);
      setFromDb(r.fromDb);
    } catch {
      setFromDb(false);
    }
  }
  useEffect(() => {
    reloadTypes();
  }, []);
  return { types, fromDb, reloadTypes };
}

type TypeDraft = { oldName: string | null; name: string; color: string };

export function CalendarScreen({ initialDate }: { initialDate: string | null }) {
  const { role, session } = useRole();
  const canWrite = role === 'admin' || role === 'hq';
  const today = todayYmd();

  const start = parseYmd(initialDate ?? today);
  const [year, setYear] = useState(start.getFullYear());
  const [month0, setMonth0] = useState(start.getMonth());
  const [selected, setSelected] = useState<string | null>(initialDate);
  const [storeFilter, setStoreFilter] = useState(''); // '' = 전체

  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const { types, fromDb, reloadTypes } = useEventTypes();
  const [typePanel, setTypePanel] = useState(false);
  const [typeDraft, setTypeDraft] = useState<TypeDraft | null>(null);
  const [typeBusy, setTypeBusy] = useState(false);
  const colorOf = (name: string) => typeColor(types, name);

  const cells = useMemo(() => monthCells(year, month0), [year, month0]);
  const monthPrefix = `${year}-${String(month0 + 1).padStart(2, '0')}`;

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  }

  async function reload() {
    try {
      setEvents(await listEvents(cells[0], cells[cells.length - 1]));
      setLoadErr('');
    } catch (e) {
      setLoadErr(errText(e));
    }
  }

  useEffect(() => {
    getLocations()
      .then((ls) => setLocations(ls.filter((l) => l.active)))
      .catch(() => setLocations([]));
  }, []);

  useEffect(() => {
    setEvents(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  const locName = (id: string | null) => (id ? locations.find((l) => l.id === id)?.name ?? '—' : '전체 매장');

  // 매장 필터: 그 매장 일정 + 전체 매장 일정
  const shown = (events ?? []).filter((e) => !storeFilter || !e.location_id || e.location_id === storeFilter);

  // 목록: 고른 날이 있으면 그날, 없으면 이번 달에 걸친 일정
  const listRows = selected
    ? shown.filter((e) => eventCovers(e, selected))
    : shown.filter((e) => e.event_date <= `${monthPrefix}-31` && (e.end_date ?? e.event_date) >= `${monthPrefix}-01`);

  function moveMonth(delta: number) {
    const d = new Date(year, month0 + delta, 1);
    setYear(d.getFullYear());
    setMonth0(d.getMonth());
    setSelected(null);
  }

  function goToday() {
    const d = parseYmd(today);
    setYear(d.getFullYear());
    setMonth0(d.getMonth());
    setSelected(today);
  }

  function clickDay(day: string) {
    if (!day.startsWith(monthPrefix)) {
      const d = parseYmd(day);
      setYear(d.getFullYear());
      setMonth0(d.getMonth());
      setSelected(day);
      return;
    }
    setSelected(selected === day ? null : day);
  }

  function beginNew(date: string) {
    setDraft({
      id: null, title: '', eventDate: date, multi: false, endDate: date, eventType: types[0]?.name ?? '기타', locationId: storeFilter, memo: '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function beginEdit(e: CalendarEvent) {
    setDraft({
      id: e.id,
      title: e.title,
      eventDate: e.event_date,
      multi: !!e.end_date && e.end_date !== e.event_date,
      endDate: e.end_date ?? e.event_date,
      eventType: e.event_type,
      locationId: e.location_id ?? '',
      memo: e.memo,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const draftErr = !draft
    ? ''
    : !draft.title.trim()
      ? '제목을 입력해 주세요'
      : !draft.eventDate
        ? '날짜를 선택해 주세요'
        : draft.multi && (!draft.endDate || draft.endDate < draft.eventDate)
          ? '끝나는 날짜가 시작 날짜보다 빠릅니다'
          : '';

  async function handleSave() {
    if (!draft || !session || draftErr) return;
    setSaving(true);
    try {
      await saveEvent(session.id, {
        id: draft.id,
        title: draft.title.trim(),
        eventDate: draft.eventDate,
        endDate: draft.multi && draft.endDate !== draft.eventDate ? draft.endDate : null,
        eventType: draft.eventType,
        locationId: draft.locationId || null,
        memo: draft.memo.trim(),
      });
      const d = parseYmd(draft.eventDate);
      const sameMonth = d.getFullYear() === year && d.getMonth() === month0;
      flash(draft.id ? '일정을 수정했습니다' : '일정을 등록했습니다');
      setDraft(null);
      setSelected(draft.eventDate);
      if (sameMonth) await reload();
      else {
        setYear(d.getFullYear());
        setMonth0(d.getMonth()); // 달이 바뀌면 cells 변경 → 자동 재조회
      }
    } catch (e) {
      flash(`저장 실패: ${errText(e)}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(e: CalendarEvent) {
    if (!session || !window.confirm(`"${e.title}" 일정을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try {
      await deleteEvent(session.id, e.id);
      await reload();
      flash('일정을 삭제했습니다');
    } catch (err) {
      flash(`삭제 실패: ${errText(err)}`);
    }
  }

  // ── 유형 관리 (본사·마스터) ───────────────────────────────
  const typeCount = (name: string) => (events ?? []).filter((e) => e.event_type === name).length;

  function beginNewType() {
    const used = new Set(types.map((t) => t.color));
    setTypeDraft({ oldName: null, name: '', color: EVENT_COLORS.find((c) => !used.has(c)) ?? EVENT_COLORS[0] });
  }

  async function saveType() {
    if (!session || !typeDraft || !typeDraft.name.trim()) return;
    const cur = types.find((t) => t.name === typeDraft.oldName);
    // 새 유형은 '기타'(맨 끝) 바로 앞 순서로
    const others = types.filter((t) => t.name !== '기타');
    const sortOrder = cur ? cur.sort_order : (others.length ? Math.max(...others.map((t) => t.sort_order)) + 10 : 10);
    setTypeBusy(true);
    try {
      const name = await saveEventType(session.id, { oldName: typeDraft.oldName, name: typeDraft.name.trim(), color: typeDraft.color, sortOrder });
      if (typeDraft.oldName && typeDraft.oldName !== name && draft?.eventType === typeDraft.oldName) setDraft({ ...draft, eventType: name });
      setTypeDraft(null);
      // 이름 변경은 DB 에서 일정에도 반영됨 → 유형·일정을 함께 다시 불러와 칩 색이 어긋나지 않게
      await Promise.all([reloadTypes(), typeDraft.oldName && typeDraft.oldName !== name ? reload() : Promise.resolve()]);
      flash(typeDraft.oldName ? '유형을 수정했습니다' : '유형을 추가했습니다');
    } catch (e) {
      flash(`저장 실패: ${errText(e)}`);
    } finally {
      setTypeBusy(false);
    }
  }

  async function removeType(t: EventTypeRow) {
    if (!session || !window.confirm(`"${t.name}" 유형을 삭제할까요?`)) return;
    setTypeBusy(true);
    try {
      await deleteEventType(session.id, t.name);
      await reloadTypes();
      flash('유형을 삭제했습니다');
    } catch (e) {
      flash(`삭제 실패: ${errText(e)}`);
    } finally {
      setTypeBusy(false);
    }
  }

  // 위/아래 이동: 이웃 유형과 순서 값 교환
  async function moveType(i: number, dir: -1 | 1) {
    const a = types[i];
    const b = types[i + dir];
    if (!session || !a || !b) return;
    const ao = a.sort_order === b.sort_order ? a.sort_order + dir : b.sort_order;
    setTypeBusy(true);
    try {
      await saveEventType(session.id, { oldName: a.name, name: a.name, color: a.color, sortOrder: ao });
      await saveEventType(session.id, { oldName: b.name, name: b.name, color: b.color, sortOrder: a.sort_order });
      await reloadTypes();
    } catch (e) {
      flash(`순서 변경 실패: ${errText(e)}`);
    } finally {
      setTypeBusy(false);
    }
  }

  function typeEditor() {
    if (!typeDraft) return null;
    return (
      <div className="cal-tp-edit">
        <input
          className="lg-input cal-tp-name"
          aria-label="유형 이름"
          value={typeDraft.name}
          maxLength={20}
          placeholder="유형 이름 (예: 행사)"
          onChange={(e) => setTypeDraft({ ...typeDraft, name: e.target.value })}
        />
        <div className="cal-colors" role="radiogroup" aria-label="유형 색">
          {EVENT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={typeDraft.color === c}
              aria-label={`색 ${c}`}
              className={`cal-color${typeDraft.color === c ? ' on' : ''}`}
              style={{ background: c }}
              onClick={() => setTypeDraft({ ...typeDraft, color: c })}
            />
          ))}
        </div>
        <EventTypeTag type={typeDraft.name.trim() || '미리보기'} color={typeDraft.color} />
        <button type="button" className="lg-btn-ghost cal-tp-btn" onClick={() => setTypeDraft(null)} disabled={typeBusy}>취소</button>
        <button type="button" className="lg-btn-ghost cal-tp-btn" onClick={saveType} disabled={typeBusy || !typeDraft.name.trim()}>
          {typeDraft.oldName ? '저장' : '추가'}
        </button>
      </div>
    );
  }

  const selDate = selected ? parseYmd(selected) : null;

  return (
    <div className="cal-wrap">
      {draft && (
        <div className="lg-form-card nt-editor">
          <p className="nt-editor-h">{draft.id ? '일정 수정' : '새 일정 등록'}</p>

          <label className="lg-label" htmlFor="cal-title">제목</label>
          <input
            id="cal-title"
            className="lg-input nt-field"
            value={draft.title}
            maxLength={80}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="예: 토이하우스 입고"
          />

          <div className="cal-form-row">
            <div>
              <label className="lg-label" htmlFor="cal-date">{draft.multi ? '시작 날짜' : '날짜'}</label>
              <input
                id="cal-date"
                type="date"
                className="lg-input nt-field"
                value={draft.eventDate}
                onChange={(e) => setDraft({ ...draft, eventDate: e.target.value, endDate: draft.endDate < e.target.value ? e.target.value : draft.endDate })}
              />
            </div>
            {draft.multi && (
              <div>
                <label className="lg-label" htmlFor="cal-end">끝나는 날짜</label>
                <input
                  id="cal-end"
                  type="date"
                  className="lg-input nt-field"
                  value={draft.endDate}
                  min={draft.eventDate}
                  onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                />
              </div>
            )}
          </div>
          <label className="nt-check cal-multi">
            <input type="checkbox" checked={draft.multi} onChange={(e) => setDraft({ ...draft, multi: e.target.checked })} />
            여러 날 일정 (팝업 기간 등)
          </label>

          <span className="lg-label">유형</span>
          <div className="cal-types" role="radiogroup" aria-label="일정 유형">
            {/* 수정 중인 일정의 유형이 목록에 없으면(삭제 경합 등) 그대로 보여줌 */}
            {[...types.map((t) => t.name), ...(types.some((t) => t.name === draft.eventType) ? [] : [draft.eventType])].map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={draft.eventType === t}
                className={`cal-type${draft.eventType === t ? ' on' : ''}`}
                style={typeStyle(colorOf(t))}
                onClick={() => setDraft({ ...draft, eventType: t })}
              >
                {t}
              </button>
            ))}
          </div>

          <label className="lg-label" htmlFor="cal-loc">관련 매장</label>
          <select
            id="cal-loc"
            className="lg-select nt-field"
            value={draft.locationId}
            onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
          >
            <option value="">전체 매장</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <label className="lg-label" htmlFor="cal-memo">메모 (선택)</label>
          <textarea
            id="cal-memo"
            className="lg-input nt-field cal-memo-in"
            rows={3}
            maxLength={500}
            value={draft.memo}
            onChange={(e) => setDraft({ ...draft, memo: e.target.value })}
            placeholder="입고 수량, 담당자 등"
          />

          {draftErr && draft.title && <p className="cal-err">{draftErr}</p>}
          <div className="nt-editor-btns">
            <button type="button" className="lg-btn-secondary" onClick={() => setDraft(null)} disabled={saving}>
              취소
            </button>
            <button type="button" className="lg-btn-main nt-save" onClick={handleSave} disabled={saving || !!draftErr}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}

      {typePanel && canWrite && (
        <div className="lg-form-card cal-tp">
          <p className="nt-editor-h">일정 유형 관리</p>
          <p className="mn-hint">이름을 바꾸면 그 유형으로 등록된 일정에도 바로 반영돼요. 일정이 남아 있는 유형은 삭제할 수 없어요.</p>
          {types.map((t, i) =>
            typeDraft?.oldName === t.name ? (
              <div key={t.name} className="cal-tp-row">{typeEditor()}</div>
            ) : (
              <div key={t.name} className="cal-tp-row">
                <EventTypeTag type={t.name} color={t.color} />
                <span className="cal-tp-cnt">{events !== null && `이번 화면 일정 ${typeCount(t.name)}개`}</span>
                <button type="button" className="cal-tp-arrow" aria-label={`${t.name} 위로`} disabled={typeBusy || i === 0} onClick={() => moveType(i, -1)}>↑</button>
                <button type="button" className="cal-tp-arrow" aria-label={`${t.name} 아래로`} disabled={typeBusy || i === types.length - 1} onClick={() => moveType(i, 1)}>↓</button>
                <button type="button" className="lg-btn-ghost cal-tp-btn" disabled={typeBusy} onClick={() => setTypeDraft({ oldName: t.name, name: t.name, color: t.color })}>수정</button>
                <button type="button" className="lg-btn-ghost cal-tp-btn nt-del" disabled={typeBusy} onClick={() => removeType(t)}>삭제</button>
              </div>
            ),
          )}
          {typeDraft?.oldName === null ? (
            typeEditor()
          ) : (
            <div className="cal-tp-edit">
              <button type="button" className="lg-btn-ghost cal-tp-btn" onClick={beginNewType} disabled={typeBusy || !!typeDraft}>+ 유형 추가</button>
            </div>
          )}
          <div className="nt-editor-btns">
            <button type="button" className="lg-btn-secondary" onClick={() => { setTypePanel(false); setTypeDraft(null); }}>
              닫기
            </button>
          </div>
        </div>
      )}

      <div className="lg-card cal-card">
        <div className="cal-bar">
          <div className="cal-nav">
            <button type="button" className="cal-arrow" onClick={() => moveMonth(-1)} aria-label="이전 달">‹</button>
            <span className="cal-month">{year}.{String(month0 + 1).padStart(2, '0')}</span>
            <button type="button" className="cal-arrow" onClick={() => moveMonth(1)} aria-label="다음 달">›</button>
            <button type="button" className="lg-btn-ghost cal-today" onClick={goToday}>오늘</button>
          </div>
          <select className="lg-select cal-store" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} aria-label="매장 필터">
            <option value="">전체 매장 보기</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          {canWrite && !draft && (
            <button type="button" className="lg-btn-ghost" onClick={() => beginNew(selected ?? (today.startsWith(monthPrefix) ? today : `${monthPrefix}-01`))}>
              + 새 일정
            </button>
          )}
        </div>

        <div className="cal-legend">
          {types.map((t) => <EventTypeTag key={t.name} type={t.name} color={t.color} />)}
          {canWrite && fromDb && !typePanel && (
            <button type="button" className="hm-more cal-type-manage" onClick={() => setTypePanel(true)}>
              유형 관리
            </button>
          )}
        </div>

        <div className="cal-grid" role="grid" aria-label={`${year}년 ${month0 + 1}월`}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} className={`cal-wd${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`} role="columnheader">{w}</div>
          ))}
          {cells.map((day, i) => {
            const inMonth = day.startsWith(monthPrefix);
            const dayEvents = shown.filter((e) => eventCovers(e, day));
            const cls = [
              'cal-cell',
              inMonth ? '' : 'out',
              day === today ? 'today' : '',
              day === selected ? 'sel' : '',
              i % 7 === 0 ? 'sun' : i % 7 === 6 ? 'sat' : '',
            ].filter(Boolean).join(' ');
            return (
              <button key={day} type="button" className={cls} onClick={() => clickDay(day)} role="gridcell" aria-selected={day === selected}>
                <span className="cal-dnum">{Number(day.slice(8))}</span>
                {dayEvents.slice(0, MAX_CHIPS).map((e) => (
                  <span key={e.id} className="cal-chip" style={typeStyle(colorOf(e.event_type))} title={e.title}>
                    {e.title}
                  </span>
                ))}
                {dayEvents.length > MAX_CHIPS && <span className="cal-more">+{dayEvents.length - MAX_CHIPS}</span>}
                {dayEvents.length > 0 && <span className="cal-dot" aria-hidden />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="lg-card nt-list">
        <div className="cal-list-h">
          <span className="cal-list-t">
            {selDate ? `${selDate.getMonth() + 1}.${selDate.getDate()}(${WEEKDAYS[selDate.getDay()]}) 일정` : `${month0 + 1}월 일정`}
            {events !== null && <span className="mn-cnt"> {listRows.length}건</span>}
          </span>
          {selected && (
            <button type="button" className="hm-more" onClick={() => setSelected(null)}>
              {month0 + 1}월 전체 보기
            </button>
          )}
          {selected && canWrite && !draft && (
            <button type="button" className="hm-more" onClick={() => beginNew(selected)}>
              + 이 날 일정 추가
            </button>
          )}
        </div>
        {loadErr ? (
          <p className="hm-empty">일정을 불러오지 못했습니다. ({loadErr})</p>
        ) : events === null ? (
          <p className="hm-empty">불러오는 중…</p>
        ) : listRows.length === 0 ? (
          <p className="hm-empty">{selected ? '이 날은 등록된 일정이 없습니다.' : '이번 달 등록된 일정이 없습니다.'}</p>
        ) : (
          listRows.map((e) => (
            <article key={e.id} className="cal-item">
              <div className="cal-item-h">
                <EventTypeTag type={e.event_type} color={colorOf(e.event_type)} />
                <span className="cal-item-t">{e.title}</span>
                <span className="nt-date">{fmtEventRange(e)}</span>
              </div>
              <p className="cal-item-meta">
                {locName(e.location_id)}
                {e.author_name && ` · 등록 ${e.author_name}`}
              </p>
              {e.memo && <p className="cal-item-memo">{e.memo}</p>}
              {canWrite && (
                <div className="nt-actions">
                  <button type="button" className="lg-btn-ghost" onClick={() => beginEdit(e)}>수정</button>
                  <button type="button" className="lg-btn-ghost nt-del" onClick={() => handleDelete(e)}>삭제</button>
                </div>
              )}
            </article>
          ))
        )}
      </div>

      {toast && <div className="lg-toast">{toast}</div>}
    </div>
  );
}
