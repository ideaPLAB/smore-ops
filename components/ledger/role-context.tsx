'use client';

import { createContext, useContext, useState, ReactNode } from 'react';
import type { Role } from '@/lib/ledger/roles';

interface RoleState {
  role: Role;
  setRole: (r: Role) => void;
  // 현재 로그인 위치 (매니저=자기 매장, 물류=창고). 프로토타입은 이름 문자열.
  locationName: string;
  setLocationName: (n: string) => void;
}

const RoleCtx = createContext<RoleState | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>('hq');
  const [locationName, setLocationName] = useState<string>('광주');
  return (
    <RoleCtx.Provider value={{ role, setRole, locationName, setLocationName }}>
      {children}
    </RoleCtx.Provider>
  );
}

export function useRole(): RoleState {
  const ctx = useContext(RoleCtx);
  if (!ctx) throw new Error('useRole must be used within RoleProvider');
  return ctx;
}
