'use client';

import { useEffect, useState, FormEvent } from 'react';
import { getLocations, SupabaseMissingError } from '@/lib/ledger/queries';
import { listAccounts, createAccount, updateAccount, resetPassword, createLocation, updateLocation, AccountRow } from '@/lib/ledger/auth';
import { ROLE_NM, ROLES, Role } from '@/lib/ledger/roles';
import { useRole } from '../role-context';
import type { LocationRow } from '@/lib/ledger/types';

const PERMISSION_ROWS = [
  { menu: '발주판 (최종수량 입력)', manager: '소속 매장', warehouse: '—', hq: '전체 + 확정' },
  { menu: '재고 현황', manager: '소속 매장', warehouse: '창고', hq: '전체' },
  { menu: '입고검수 · 자가사용 · 가챠', manager: '소속 매장', warehouse: '—', hq: '전체' },
  { menu: '출고 대기열 · 입고 처리', manager: '—', warehouse: '창고 작업', hq: '전체' },
  { menu: '상품관리', manager: '—', warehouse: '—', hq: '본사·마스터' },
  { menu: '계정 관리', manager: '—', warehouse: '—', hq: '마스터 전용' },
];

const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px', color: 'var(--lg-muted)', fontWeight: 600 };
const inputStyle: React.CSSProperties = {
  padding: '8px 10px', border: '1px solid var(--lg-line)', borderRadius: 7,
  fontSize: '.82rem', background: 'var(--lg-bg)', boxSizing: 'border-box',
};

function locationTypeLabel(type: string) {
  if (type === 'store') return '상설';
  if (type === 'popup') return '팝업';
  if (type === 'warehouse') return '창고';
  if (type === 'zerozone') return '제로존';
  return type;
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function AccountsScreen() {
  const { session } = useRole();
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'noenv' | 'error'>('loading');
  const [errMsg, setErrMsg] = useState('');
  const [actionMsg, setActionMsg] = useState('');

  // 새 계정 폼
  const [fUsername, setFUsername] = useState('');
  const [fPassword, setFPassword] = useState('');
  const [fName, setFName] = useState('');
  const [fRole, setFRole] = useState<Role>('manager');
  const [fLocation, setFLocation] = useState('');
  const [creating, setCreating] = useState(false);

  // 매장 추가 폼
  const [lName, setLName] = useState('');
  const [lType, setLType] = useState('store');
  const [lEcount, setLEcount] = useState('');
  const [lCloses, setLCloses] = useState('');
  const [creatingLoc, setCreatingLoc] = useState(false);

  const isMaster = session?.role === 'admin';

  async function load() {
    if (!session) return;
    try {
      const [locs, accs] = await Promise.all([
        getLocations(),
        isMaster ? listAccounts(session.id) : Promise.resolve([]),
      ]);
      setLocations(locs);
      setAccounts(accs);
      setStatus('ready');
    } catch (e) {
      if (e instanceof SupabaseMissingError) setStatus('noenv');
      else { setErrMsg((e as Error)?.message ?? String(e)); setStatus('error'); }
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 마스터가 아니면 안내만 (탭 자체가 마스터 전용이지만 이중 방어)
  if (!isMaster) {
    return (
      <section className="lg-screen">
        <div className="lg-card lg-empty">계정 관리는 마스터 계정만 접근할 수 있습니다.</div>
      </section>
    );
  }

  const activeLocations = locations.filter((l) => l.active);
  const storeLocations = activeLocations.filter((l) => l.type === 'store' || l.type === 'popup');

  async function submitCreate(e: FormEvent) {
    e.preventDefault();
    if (!session || creating) return;
    setCreating(true);
    setActionMsg('');
    try {
      await createAccount(session.id, {
        username: fUsername,
        password: fPassword,
        displayName: fName,
        role: fRole,
        locationName: fRole === 'manager' ? fLocation : fRole === 'warehouse' ? '광주' : null,
      });
      setFUsername(''); setFPassword(''); setFName(''); setFRole('manager'); setFLocation('');
      setActionMsg(`계정 생성 완료: ${fUsername}`);
      await load();
    } catch (e) {
      setActionMsg(`생성 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setCreating(false);
    }
  }

  async function changeRole(acc: AccountRow, role: Role) {
    if (!session) return;
    setActionMsg('');
    try {
      await updateAccount(session.id, {
        id: acc.id, role,
        locationName: role === 'manager' ? acc.location_name : role === 'warehouse' ? '광주' : null,
        active: acc.active,
      });
      await load();
    } catch (e) {
      setActionMsg(`역할 변경 실패: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async function changeLocation(acc: AccountRow, locationName: string) {
    if (!session) return;
    setActionMsg('');
    try {
      await updateAccount(session.id, { id: acc.id, role: acc.role, locationName: locationName || null, active: acc.active });
      await load();
    } catch (e) {
      setActionMsg(`소속 변경 실패: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async function toggleActive(acc: AccountRow) {
    if (!session) return;
    if (acc.active && !window.confirm(`${acc.username} 계정을 비활성화할까요? 로그인이 차단됩니다.`)) return;
    setActionMsg('');
    try {
      await updateAccount(session.id, { id: acc.id, role: acc.role, locationName: acc.location_name, active: !acc.active });
      await load();
    } catch (e) {
      setActionMsg(`상태 변경 실패: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async function submitCreateLocation(e: FormEvent) {
    e.preventDefault();
    if (!session || creatingLoc) return;
    setCreatingLoc(true);
    setActionMsg('');
    try {
      await createLocation(session.id, {
        name: lName,
        type: lType,
        ecountCode: lEcount || null,
        opensAt: null,
        closesAt: lType === 'popup' && lCloses ? lCloses : null,
      });
      setActionMsg(`매장 추가 완료: ${lName.trim()}`);
      setLName(''); setLType('store'); setLEcount(''); setLCloses('');
      await load();
    } catch (e) {
      setActionMsg(`매장 추가 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setCreatingLoc(false);
    }
  }

  async function toggleLocationActive(loc: LocationRow) {
    if (!session) return;
    if (loc.active && !window.confirm(`${loc.name} 매장을 비활성화할까요?`)) return;
    setActionMsg('');
    try {
      await updateLocation(session.id, {
        id: loc.id, active: !loc.active,
        ecountCode: loc.ecount_code, closesAt: loc.closes_at,
      });
      await load();
    } catch (e) {
      setActionMsg(`매장 상태 변경 실패: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  async function doResetPassword(acc: AccountRow) {
    if (!session) return;
    const pw = window.prompt(`${acc.username} 새 비밀번호 (6자 이상):`);
    if (!pw) return;
    setActionMsg('');
    try {
      await resetPassword(session.id, acc.id, pw);
      setActionMsg(`비밀번호 재설정 완료: ${acc.username}`);
    } catch (e) {
      setActionMsg(`재설정 실패: ${(e as Error)?.message ?? String(e)}`);
    }
  }

  return (
    <section className="lg-screen">
      <div className="lg-page-head">
        <div>
          <p className="lg-sub">계정 발급·권한 부여 — 마스터 계정 전용</p>
        </div>
      </div>

      {status === 'loading' && <div className="lg-card lg-empty">불러오는 중…</div>}
      {status === 'noenv' && <div className="lg-card lg-empty">Supabase 환경 변수 없음 — <code>.env.local</code> 설정 필요</div>}
      {status === 'error' && <div className="lg-card lg-empty lg-err">불러오기 실패: {errMsg}</div>}

      {status === 'ready' && (
        <>
          {actionMsg && (
            <div className="lg-card" style={{ marginBottom: 14, padding: '10px 16px', fontSize: '.82rem', color: actionMsg.includes('실패') ? '#c0392b' : 'var(--lg-pine, #2f5d50)' }}>
              {actionMsg}
            </div>
          )}

          {/* 새 계정 발급 */}
          <div className="lg-card" style={{ marginBottom: 14, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, fontSize: '.88rem', marginBottom: 10 }}>새 계정 발급</div>
            <form onSubmit={submitCreate} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <input style={{ ...inputStyle, width: 130 }} placeholder="아이디" value={fUsername} onChange={(e) => setFUsername(e.target.value)} autoComplete="off" />
              <input style={{ ...inputStyle, width: 140 }} type="password" placeholder="비밀번호 (6자+)" value={fPassword} onChange={(e) => setFPassword(e.target.value)} autoComplete="new-password" />
              <input style={{ ...inputStyle, width: 110 }} placeholder="이름" value={fName} onChange={(e) => setFName(e.target.value)} autoComplete="off" />
              <select style={{ ...inputStyle, width: 120 }} value={fRole} onChange={(e) => setFRole(e.target.value as Role)}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_NM[r]}</option>)}
              </select>
              {fRole === 'manager' && (
                <select style={{ ...inputStyle, width: 150 }} value={fLocation} onChange={(e) => setFLocation(e.target.value)}>
                  <option value="">소속 매장 선택</option>
                  {storeLocations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                </select>
              )}
              <button
                type="submit"
                disabled={creating || !fUsername.trim() || fPassword.length < 6 || (fRole === 'manager' && !fLocation)}
                style={{
                  padding: '9px 18px', border: 'none', borderRadius: 7,
                  background: 'var(--lg-pine, #2f5d50)', color: '#fff', fontWeight: 700, fontSize: '.82rem',
                  cursor: 'pointer',
                  opacity: creating || !fUsername.trim() || fPassword.length < 6 || (fRole === 'manager' && !fLocation) ? 0.55 : 1,
                }}
              >
                {creating ? '생성 중…' : '계정 생성'}
              </button>
            </form>
            <p style={{ margin: '10px 0 0', fontSize: '.74rem', color: 'var(--lg-muted)' }}>
              물류 계정은 소속이 광주로 자동 지정됩니다. 비밀번호는 생성 후 본인에게 직접 전달하세요.
            </p>
          </div>

          {/* 계정 목록 */}
          <div className="lg-card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '.88rem', padding: '12px 16px 10px', borderBottom: '1px solid var(--lg-line)' }}>
              계정 목록
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.82rem' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 16 }}>아이디</th>
                  <th style={thStyle}>이름</th>
                  <th style={thStyle}>역할</th>
                  <th style={thStyle}>소속</th>
                  <th style={thStyle}>마지막 로그인</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>상태</th>
                  <th style={{ ...thStyle, textAlign: 'right', paddingRight: 16 }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const isSelf = a.id === session?.id;
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--lg-line)', opacity: a.active ? 1 : 0.45 }}>
                      <td style={{ padding: '8px 8px 8px 16px', fontWeight: 600 }}>
                        {a.username}{isSelf && <span style={{ marginLeft: 6, fontSize: '.7rem', color: 'var(--lg-muted)' }}>(나)</span>}
                      </td>
                      <td style={{ padding: '8px' }}>{a.display_name || '—'}</td>
                      <td style={{ padding: '8px' }}>
                        <select
                          style={{ ...inputStyle, padding: '4px 6px', fontSize: '.78rem' }}
                          value={a.role}
                          disabled={isSelf}
                          onChange={(e) => changeRole(a, e.target.value as Role)}
                        >
                          {ROLES.map((r) => <option key={r} value={r}>{ROLE_NM[r]}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {a.role === 'manager' ? (
                          <select
                            style={{ ...inputStyle, padding: '4px 6px', fontSize: '.78rem' }}
                            value={a.location_name ?? ''}
                            onChange={(e) => changeLocation(a, e.target.value)}
                          >
                            <option value="">—</option>
                            {storeLocations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--lg-muted)' }}>{a.location_name ?? '—'}</span>
                        )}
                      </td>
                      <td style={{ padding: '8px', fontSize: '.76rem', color: 'var(--lg-muted)' }}>{fmtDate(a.last_login_at)}</td>
                      <td style={{ padding: '8px', textAlign: 'center' }}>
                        <span className={`lg-tag${a.active ? '' : ' lg-tag-dev'}`}>{a.active ? '활성' : '비활성'}</span>
                      </td>
                      <td style={{ padding: '8px 16px 8px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button type="button" onClick={() => doResetPassword(a)} style={{ padding: '4px 8px', fontSize: '.72rem', border: '1px solid var(--lg-line)', borderRadius: 6, background: 'transparent', cursor: 'pointer', marginRight: 6 }}>
                          비번 재설정
                        </button>
                        {!isSelf && (
                          <button type="button" onClick={() => toggleActive(a)} style={{ padding: '4px 8px', fontSize: '.72rem', border: '1px solid var(--lg-line)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: a.active ? '#c0392b' : undefined }}>
                            {a.active ? '비활성화' : '활성화'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {accounts.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '16px', textAlign: 'center', color: 'var(--lg-muted)' }}>등록된 계정이 없습니다 — schema_patch_v0_25.sql 실행 여부를 확인하세요</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 매장 현황 */}
          <div className="lg-card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700, fontSize: '.88rem', padding: '12px 16px 10px', borderBottom: '1px solid var(--lg-line)' }}>
              매장 현황
            </div>

            {/* 매장 추가 */}
            <form onSubmit={submitCreateLocation} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--lg-line)' }}>
              <input style={{ ...inputStyle, width: 150 }} placeholder="매장 이름" value={lName} onChange={(e) => setLName(e.target.value)} autoComplete="off" />
              <select style={{ ...inputStyle, width: 100 }} value={lType} onChange={(e) => setLType(e.target.value)}>
                <option value="store">상설</option>
                <option value="popup">팝업</option>
                <option value="warehouse">창고</option>
                <option value="zerozone">제로존</option>
              </select>
              <input style={{ ...inputStyle, width: 130 }} placeholder="이카운트 코드 (선택)" value={lEcount} onChange={(e) => setLEcount(e.target.value)} autoComplete="off" />
              {lType === 'popup' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.76rem', color: 'var(--lg-muted)' }}>
                  마감일
                  <input style={{ ...inputStyle, width: 140 }} type="date" value={lCloses} onChange={(e) => setLCloses(e.target.value)} />
                </label>
              )}
              <button
                type="submit"
                disabled={creatingLoc || lName.trim().length < 2}
                style={{
                  padding: '9px 18px', border: 'none', borderRadius: 7,
                  background: 'var(--lg-pine, #2f5d50)', color: '#fff', fontWeight: 700, fontSize: '.82rem',
                  cursor: 'pointer', opacity: creatingLoc || lName.trim().length < 2 ? 0.55 : 1,
                }}
              >
                {creatingLoc ? '추가 중…' : '매장 추가'}
              </button>
            </form>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 16 }}>이름</th>
                  <th style={thStyle}>유형</th>
                  <th style={thStyle}>이카운트 코드</th>
                  <th style={thStyle}>팝업 마감</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>상태</th>
                  <th style={{ ...thStyle, textAlign: 'right', paddingRight: 16 }}>관리</th>
                </tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid var(--lg-line)', opacity: l.active ? 1 : 0.45 }}>
                    <td style={{ padding: '8px 8px 8px 16px', fontWeight: l.active ? 600 : 400 }}>{l.name}</td>
                    <td style={{ padding: '8px', color: 'var(--lg-muted)' }}>{locationTypeLabel(l.type)}</td>
                    <td style={{ padding: '8px', fontFamily: 'monospace', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{l.ecount_code ?? '—'}</td>
                    <td style={{ padding: '8px', fontSize: '.78rem', color: 'var(--lg-muted)' }}>{l.closes_at ?? '—'}</td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <span className={`lg-tag${l.active ? '' : ' lg-tag-dev'}`}>{l.active ? '활성' : '비활성'}</span>
                    </td>
                    <td style={{ padding: '8px 16px 8px 8px', textAlign: 'right' }}>
                      <button type="button" onClick={() => toggleLocationActive(l)} style={{ padding: '4px 8px', fontSize: '.72rem', border: '1px solid var(--lg-line)', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: l.active ? '#c0392b' : undefined }}>
                        {l.active ? '비활성화' : '활성화'}
                      </button>
                    </td>
                  </tr>
                ))}
                {locations.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: '16px', textAlign: 'center', color: 'var(--lg-muted)' }}>등록된 매장이 없습니다</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* 역할별 권한 요약 */}
          <div className="lg-card">
            <div style={{ fontWeight: 700, fontSize: '.88rem', padding: '12px 16px 10px', borderBottom: '1px solid var(--lg-line)' }}>
              역할별 권한 요약
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8rem' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, paddingLeft: 16 }}>메뉴</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>매장 매니저</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>물류</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>본사</th>
                </tr>
              </thead>
              <tbody>
                {PERMISSION_ROWS.map((r) => (
                  <tr key={r.menu} style={{ borderTop: '1px solid var(--lg-line)' }}>
                    <td style={{ padding: '8px 16px' }}>{r.menu}</td>
                    <td style={{ padding: '8px', textAlign: 'center', color: r.manager === '—' ? 'var(--lg-muted)' : undefined }}>{r.manager}</td>
                    <td style={{ padding: '8px', textAlign: 'center', color: r.warehouse === '—' ? 'var(--lg-muted)' : undefined }}>{r.warehouse}</td>
                    <td style={{ padding: '8px', textAlign: 'center', fontWeight: 600 }}>{r.hq}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ padding: '10px 16px', fontSize: '.75rem', color: 'var(--lg-muted)', borderTop: '1px solid var(--lg-line)', margin: 0 }}>
              로그인은 12시간 뒤 자동 만료되고, 브라우저를 닫으면 로그아웃됩니다.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
