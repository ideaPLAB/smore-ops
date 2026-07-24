'use client';

import { useState, FormEvent } from 'react';
import { loginAccount } from '@/lib/ledger/auth';
import { SupabaseMissingError } from '@/lib/ledger/queries';
import { useRole } from '../role-context';

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--lg-line)',
  borderRadius: 8,
  fontSize: '.9rem',
  background: 'var(--lg-bg)',
  boxSizing: 'border-box',
};

export function LoginScreen() {
  const { login } = useRole();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setErr('');
    try {
      const acc = await loginAccount(username, password);
      if (!acc) {
        setErr('아이디 또는 비밀번호가 올바르지 않습니다');
        return;
      }
      login(acc);
    } catch (e) {
      if (e instanceof SupabaseMissingError) setErr(e.message);
      else setErr(`로그인 실패: ${(e as Error)?.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ledger" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <form onSubmit={submit} className="lg-card" style={{ width: 340, padding: '28px 26px' }}>
        <p className="lg-logo" style={{ margin: '0 0 4px' }}>+SMORE OPS.</p>
        <p style={{ margin: '0 0 20px', fontSize: '.8rem', color: 'var(--lg-muted)' }}>
          재고원장 로그인
        </p>

        <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, marginBottom: 6 }}>아이디</label>
        <input
          style={{ ...inputStyle, marginBottom: 14 }}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          autoFocus
        />

        <label style={{ display: 'block', fontSize: '.78rem', fontWeight: 600, marginBottom: 6 }}>비밀번호</label>
        <input
          style={{ ...inputStyle, marginBottom: 18 }}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />

        {err && (
          <div style={{ marginBottom: 14, fontSize: '.78rem', color: '#c0392b', lineHeight: 1.5 }}>{err}</div>
        )}

        <button
          type="submit"
          disabled={busy || !username.trim() || !password}
          style={{
            width: '100%',
            padding: '11px 0',
            border: 'none',
            borderRadius: 8,
            background: 'var(--lg-pine, #2f5d50)',
            color: '#fff',
            fontWeight: 700,
            fontSize: '.9rem',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy || !username.trim() || !password ? 0.6 : 1,
          }}
        >
          {busy ? '확인 중…' : '로그인'}
        </button>

        <p style={{ margin: '16px 0 0', fontSize: '.72rem', color: 'var(--lg-muted)', lineHeight: 1.6 }}>
          로그인은 12시간 뒤 자동 만료되고, 브라우저를 닫으면 로그아웃됩니다.
          <br />계정 발급·비밀번호 재설정은 본사 마스터에게 문의하세요.
        </p>
      </form>
    </div>
  );
}
