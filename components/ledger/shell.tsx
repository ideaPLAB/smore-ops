'use client';

import { useState } from 'react';
import { RoleProvider, useRole } from './role-context';
import { ROLE_TABS, ROLE_NM, ROLES, SCREEN_NM, ScreenId } from '@/lib/ledger/roles';
import { TransitScreen } from './screens/transit-screen';
import { BoardScreen } from './screens/board-screen';
import { DispatchScreen } from './screens/dispatch-screen';
import { StockScreen } from './screens/stock-screen';
import { ReceiptScreen } from './screens/receipt-screen';
import { GachaScreen } from './screens/gacha-screen';
import { SelfuseScreen } from './screens/selfuse-screen';
import { QueueScreen } from './screens/queue-screen';
import { InboundScreen } from './screens/inbound-screen';
import { StoreTransferScreen } from './screens/store-transfer-screen';
import { SalesScreen } from './screens/sales-screen';
import { ItemsScreen } from './screens/items-screen';
import { AccountsScreen } from './screens/accounts-screen';
import { GuideScreen } from './screens/guide-screen';
import { WikiScreen } from './screens/wiki-screen';
import { LoginScreen } from './screens/login-screen';

function ScreenHost({ screen }: { screen: ScreenId }) {
  switch (screen) {
    case 'board':
      return <BoardScreen />;
    case 'stock':
      return <StockScreen />;
    case 'receipt':
      return <ReceiptScreen />;
    case 'gacha':
      return <GachaScreen />;
    case 'selfuse':
      return <SelfuseScreen />;
    case 'queue':
      return <QueueScreen />;
    case 'transit':
      return <TransitScreen />;
    case 'dispatch':
      return <DispatchScreen />;
    case 'inbound':
      return <InboundScreen />;
    case 'store-transfer':
      return <StoreTransferScreen />;
    case 'sales':
      return <SalesScreen />;
    case 'items':
      return <ItemsScreen />;
    case 'accounts':
      return <AccountsScreen />;
    case 'wiki':
      return <WikiScreen />;
    case 'guide':
      return <GuideScreen />;
    default:
      return null;
  }
}

function ShellInner() {
  const { role, setRole, session, logout } = useRole();
  const tabs = ROLE_TABS[role];
  const [screen, setScreen] = useState<ScreenId>(tabs[0]);

  // 역할을 바꾸면 접근 불가 화면이면 첫 탭으로 이동 (마스터 전용 미리보기)
  function changeRole(r: typeof role) {
    setRole(r);
    const next = ROLE_TABS[r];
    if (!next.includes(screen)) setScreen(next[0]);
  }

  if (!session) return null;

  return (
    <div className="ledger">
      <aside className="lg-sidebar">
        <div className="lg-brand">
          <p className="lg-logo">+SMORE OPS.</p>
        </div>
        <nav className="lg-nav">
          {tabs.map((t) => (
            <button
              key={t}
              type="button"
              className={`lg-navbtn${t === screen ? ' on' : ''}`}
              onClick={() => setScreen(t)}
            >
              {SCREEN_NM[t]}
            </button>
          ))}
        </nav>
      </aside>

      <div className="lg-content">
        <header className="lg-topbar">
          <h1 className="lg-title">{SCREEN_NM[screen]}</h1>
          <div className="lg-rolebox" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {session.role === 'admin' ? (
              <select
                aria-label="역할 전환 (마스터 미리보기)"
                className="lg-roleselect"
                value={role}
                onChange={(e) => changeRole(e.target.value as typeof role)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_NM[r]}
                  </option>
                ))}
              </select>
            ) : (
              <span style={{ fontSize: '.8rem', color: 'var(--lg-muted)' }}>
                {ROLE_NM[role]}
                {session.location_name ? ` · ${session.location_name}` : ''}
              </span>
            )}
            <span style={{ fontSize: '.8rem', fontWeight: 600 }}>
              {session.display_name || session.username}
            </span>
            <button
              type="button"
              onClick={logout}
              style={{
                padding: '5px 10px',
                fontSize: '.74rem',
                border: '1px solid var(--lg-line)',
                borderRadius: 7,
                background: 'transparent',
                color: 'var(--lg-muted)',
                cursor: 'pointer',
              }}
            >
              로그아웃
            </button>
          </div>
        </header>

        <main className="lg-main">
          <ScreenHost screen={screen} />
        </main>

        <footer className="lg-foot">모든 전표는 히스토리에 적재됩니다 · 재고 잔액은 이벤트 합산이 원천</footer>
      </div>
    </div>
  );
}

function ShellGate() {
  const { session, ready } = useRole();
  if (!ready) return null; // sessionStorage 복원 전 깜빡임 방지
  if (!session) return <LoginScreen />;
  return <ShellInner />;
}

export function LedgerShell() {
  return (
    <RoleProvider>
      <ShellGate />
    </RoleProvider>
  );
}
