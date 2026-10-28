// 管理员会话：HMAC-SHA256 签名 token，存 HttpOnly Cookie
import { K, kvGet } from './store.js';

const TOKEN_TTL_SECONDS = 12 * 3600; // 12 小时
export const COOKIE_NAME = 'nav_admin';

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return b64url(new Uint8Array(sig));
}

export async function createToken(env, user, pv = 1) {
  const secret = await env.NAV_KV.get(K.SECRET);
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ u: user, pv, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS, v: 1 })));
  const sig = await hmac(secret, payload);
  return payload + '.' + sig;
}

export async function verifyToken(env, token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const secret = await env.NAV_KV.get(K.SECRET);
  const expect = await hmac(secret, payload);
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlDecode(payload)));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch { return null; }
}

export function getTokenFromRequest(request) {
  const cookie = request.headers.get('Cookie') || '';
  const m = cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  return m ? m[1] : '';
}

// 校验管理员身份；通过返回 token 数据，否则返回 null
export async function requireAdmin(env, request) {
  const token = getTokenFromRequest(request);
  const data = await verifyToken(env, token);
  if (!data) return null;
  const admin = await kvGet(env, K.ADMIN, null);
  if (!admin || admin.user !== data.u) return null;
  // 密码版本号不一致（改过密码/用户名）→ 旧 token 全部作废
  if ((admin.pv || 1) !== (data.pv || 1)) return null;
  return data;
}

export function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${TOKEN_TTL_SECONDS}`;
}
export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
