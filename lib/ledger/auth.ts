// 로그인/계정관리 RPC 래퍼 (schema_patch_v0_25).
// app_accounts 테이블은 anon GRANT 없음 — 반드시 RPC 경유, 해시는 클라이언트로 안 내려옴.
import { getSupabaseClient } from '@/lib/supabase';
import { SupabaseMissingError } from './queries';
import type { Role } from './roles';

export interface SessionAccount {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  location_name: string | null;
}

export interface AccountRow extends SessionAccount {
  active: boolean;
  created_at: string;
  last_login_at: string | null;
}

function client() {
  const sb = getSupabaseClient();
  if (!sb) throw new SupabaseMissingError();
  return sb;
}

// 성공 시 계정 정보, 아이디/비밀번호 불일치 시 null
export async function loginAccount(username: string, password: string): Promise<SessionAccount | null> {
  const { data, error } = await client().rpc('app_login', {
    p_username: username, p_password: password,
  });
  if (error) throw error;
  return (data as SessionAccount | null) ?? null;
}

export async function listAccounts(actorId: string): Promise<AccountRow[]> {
  const { data, error } = await client().rpc('app_list_accounts', { p_actor: actorId });
  if (error) throw error;
  return (data ?? []) as AccountRow[];
}

export async function createAccount(
  actorId: string,
  input: { username: string; password: string; displayName: string; role: Role; locationName: string | null },
): Promise<void> {
  const { error } = await client().rpc('app_create_account', {
    p_actor: actorId,
    p_username: input.username,
    p_password: input.password,
    p_display_name: input.displayName,
    p_role: input.role,
    p_location_name: input.locationName,
  });
  if (error) throw error;
}

export async function updateAccount(
  actorId: string,
  input: { id: string; role: Role; locationName: string | null; active: boolean },
): Promise<void> {
  const { error } = await client().rpc('app_update_account', {
    p_actor: actorId,
    p_id: input.id,
    p_role: input.role,
    p_location_name: input.locationName,
    p_active: input.active,
  });
  if (error) throw error;
}

export async function resetPassword(actorId: string, id: string, password: string): Promise<void> {
  const { error } = await client().rpc('app_reset_password', {
    p_actor: actorId, p_id: id, p_password: password,
  });
  if (error) throw error;
}

// ── 매장 관리 (schema_patch_v0_26, 마스터 전용) ──────────────────────────────

export async function createLocation(
  actorId: string,
  input: { name: string; type: string; ecountCode: string | null; opensAt: string | null; closesAt: string | null },
): Promise<void> {
  const { error } = await client().rpc('app_create_location', {
    p_actor: actorId,
    p_name: input.name,
    p_type: input.type,
    p_ecount_code: input.ecountCode,
    p_opens_at: input.opensAt,
    p_closes_at: input.closesAt,
  });
  if (error) throw error;
}

export async function updateLocation(
  actorId: string,
  input: { id: string; active: boolean; ecountCode: string | null; closesAt: string | null },
): Promise<void> {
  const { error } = await client().rpc('app_update_location', {
    p_actor: actorId,
    p_id: input.id,
    p_active: input.active,
    p_ecount_code: input.ecountCode,
    p_closes_at: input.closesAt,
  });
  if (error) throw error;
}
