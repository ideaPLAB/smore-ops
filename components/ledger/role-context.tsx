'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { Role } from '@/lib/ledger/roles';
import type { SessionAccount } from '@/lib/ledger/auth';

// 세션은 sessionStorage 에만 저장 — 브라우저(탭)를 닫으면 로그아웃.
// 추가로 12시간 지나면 자동 만료 (매장 공용 기기 로그인 방치 방지).
const SESSION_KEY = 'smoreops.session';
const SESSION_HOURS = 12;

interface StoredSession {
  account: SessionAccount;
  exp: number; // epoch ms
}

function readStored(): SessionAccount | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed?.account?.id || !parsed.exp || Date.now() > parsed.exp) {
      window.sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return parsed.account;
  } catch {
    return null;
  }
}

interface RoleState {
  session: SessionAccount | null;
  login: (acc: SessionAccount) => void;
  logout: () => void;
  ready: boolean; // sessionStorage 복원 완료 여부
  // 화면 표시용 역할. 마스터(admin)만 드롭다운으로 다른 역할 화면 미리보기 가능.
  role: Role;
  setRole: (r: Role) => void;
  // 현재 로그인 위치 (매니저=자기 매장, 물류=창고)
  locationName: string;
  setLocationName: (n: string) => void;
}

const RoleCtx = createContext<RoleState | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [viewRole, setViewRole] = useState<Role | null>(null);
  const [locationName, setLocationName] = useState<string>('광주');

  useEffect(() => {
    const acc = readStored();
    if (acc) {
      setSession(acc);
      if (acc.location_name) setLocationName(acc.location_name);
    }
    setReady(true);
    // 만료 감시 — 만료 시각이 지나면 자동 로그아웃
    const t = setInterval(() => {
      if (window.sessionStorage.getItem(SESSION_KEY) && !readStored()) {
        setSession(null);
        setViewRole(null);
      }
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  function login(acc: SessionAccount) {
    const stored: StoredSession = { account: acc, exp: Date.now() + SESSION_HOURS * 3600_000 };
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(stored));
    setSession(acc);
    setViewRole(null);
    if (acc.location_name) setLocationName(acc.location_name);
  }

  function logout() {
    window.sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setViewRole(null);
  }

  const role: Role = viewRole ?? session?.role ?? 'manager';

  function setRole(r: Role) {
    if (session?.role === 'admin') setViewRole(r);
  }

  return (
    <RoleCtx.Provider value={{ session, login, logout, ready, role, setRole, locationName, setLocationName }}>
      {children}
    </RoleCtx.Provider>
  );
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
