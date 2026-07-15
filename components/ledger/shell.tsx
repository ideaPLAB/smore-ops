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
import { Placeholder } from './screens/placeholder';

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
    default:
      return <Placeholder title={SCREEN_NM[screen]} />;
  }
}

function ShellInner() {
  const { role, setRole, locationName } = useRole();
  const tabs = ROLE_TABS[role];
  const [screen, setScreen] = useState<ScreenId>(tabs[0]);

  // 역할을 바꾸면 접근 불가 화면이면 첫 탭으로 이동
  function changeRole(r: typeof role) {
    setRole(r);
    const next = ROLE_TABS[r];
    if (!next.includes(screen)) setScreen(next[0]);
  }

  return (
    <div className="ledger">
      <header className="lg-topbar">
        <div>
          <p className="lg-eyebrow">Smore Ops · 재고원장</p>
          <h1 className="lg-title">{SCREEN_NM[screen]}</h1>
        </div>
        <div className="lg-rolebox">
          <span className="lg-loc">{locationName}</span>
          <select
            aria-label="역할 전환"
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
        </div>
      </header>

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

      <main className="lg-main">
        <ScreenHost screen={screen} />
      </main>

      <footer className="lg-foot">모든 전표는 히스토리에 적재됩니다 · 재고 잔액은 이벤트 합산이 원천</footer>
    </div>
  );
}

export function LedgerShell() {
  return (
    <RoleProvider>
      <ShellInner />
    </RoleProvider>
  );
}
