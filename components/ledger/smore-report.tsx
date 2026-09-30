'use client';

// /smore_report — 왼쪽 메뉴바 없는 매출 대시보드 전용 페이지.
// 세션은 OPS와 같은 sessionStorage 를 쓰므로 같은 탭에서 넘어오면 로그인 유지, 주소로 바로 오면 로그인 화면부터.
import Link from 'next/link';
import { RoleProvider, useRole } from './role-context';
import { LoginScreen } from './screens/login-screen';
import { SalesDashboardScreen } from './screens/sales-dashboard-screen';
import { isHqRole } from '@/lib/ledger/roles';

function ReportGate() {
  const { session, ready, role, logout } = useRole();
  if (!ready) return null; // sessionStorage 복원 전 깜빡임 방지
  if (!session) return <LoginScreen />;
  return (
    <div className="ledger sr">
      <header className="sr-top">
        <Link href="/" className="sr-back">
          ← OPS
        </Link>
        <span className="sr-logo">
          +SMORE <b>REPORT</b>
        </span>
        <span className="sr-user">
          <span className="sr-name">{session.display_name || session.username}</span>
          <button type="button" onClick={logout}>
            로그아웃
          </button>
        </span>
      </header>
      <main className="sr-main">
        {isHqRole(role) ? <SalesDashboardScreen /> : <div className="lg-card lg-empty">본사·마스터 계정만 볼 수 있는 화면입니다.</div>}
      </main>
    </div>
  );
}

export function SmoreReport() {
  return (
    <RoleProvider>
      <ReportGate />
    </RoleProvider>
  );
}
