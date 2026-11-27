// Microsoft -> Xbox Live -> XSTS -> Minecraft Services auth chain.
//
// This uses the legacy Xbox Live sign-in page
// (login.live.com/oauth20_authorize.srf) rather than the newer Azure AD v2
// device-code endpoint (login.microsoftonline.com/.../devicecode). The v2
// device-code endpoint rejects the public "vanilla launcher" client id below
// for many accounts/tenants with AADSTS700016 ("Application ... was not
// found in the directory") — that's a restriction on the app registration
// itself, not something fixable from here. The old login.live.com endpoint,
// used by the official launcher and older open-source ones, still accepts
// this same client id, so we drive the user through it in a popup window
// (see ipc.js) and pull the result out of the redirect URL.
//
// The popup asks for an authorization *code* (response_type=code) instead of
// a bare access token, and the code is then exchanged at oauth20_token.srf
// for an access token plus a long-lived refresh token. The Minecraft session
// token itself only lives ~24h, but the refresh token lets us silently mint
// a fresh one (see refreshAccount) so the user doesn't have to sign in again.
const CLIENT_ID = '00000000402b5328';
const LIVE_AUTH_URL = 'https://login.live.com/oauth20_authorize.srf';
const LIVE_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const LIVE_SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL';

function buildLiveAuthUrl() {
  const redirect = encodeURIComponent(REDIRECT_URI);
  return `${LIVE_AUTH_URL}?client_id=${CLIENT_ID}`
    + `&response_type=code&redirect_uri=${redirect}`
    + `&scope=${encodeURIComponent(LIVE_SCOPE)}`
    + '&prompt=select_account&display=touch';
}

function isRedirectUrl(url) {
  return url.startsWith(REDIRECT_URI) && (url.includes('access_token=') || url.includes('code=') || url.includes('error='));
}

function extractAuthCodeFromUrl(url) {
  const qIdx = url.indexOf('?');
  if (qIdx === -1) return null;
  const query = url.slice(qIdx + 1).split('#')[0];
  return new URLSearchParams(query).get('code');
}

// A request that gets no answer must not hold the sign-in (and the launch behind it) forever: after this long it fails with a clear message.
const REQUEST_TIMEOUT_MS = 20000;
async function timedFetch(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      throw new Error(`No ответа от ${new URL(url).hostname} за ${REQUEST_TIMEOUT_MS / 1000} с. Проверьте интернет, VPN или прокси и попробуйте ещё раз.`);
    }
    throw err;
  }
}

async function requestLiveToken(params) {
  const res = await timedFetch(LIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: LIVE_SCOPE,
      ...params,
    }).toString(),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    const err = new Error(`Microsoft отклонил вход (${json.error || res.status})`);
    // invalid_grant = the refresh token was revoked/expired for good.
    err.needsRelogin = json.error === 'invalid_grant' || res.status === 400 || res.status === 401;
    throw err;
  }
  return json; // { access_token, refresh_token, expires_in, ... }
}

const exchangeAuthCode = (code) => requestLiveToken({ code, grant_type: 'authorization_code' });
const refreshLiveToken = (refreshToken) => requestLiveToken({ refresh_token: refreshToken, grant_type: 'refresh_token' });

function extractAccessTokenFromUrl(url) {
  const hashIdx = url.indexOf('#');
  if (hashIdx === -1) return null;
  const fragment = url.slice(hashIdx + 1);
  for (const part of fragment.split('&')) {
    if (part.startsWith('access_token=')) {
      return decodeURIComponent(part.slice('access_token='.length).replace(/\+/g, '%2B'));
    }
  }
  return null;
}

async function authXboxLive(msAccessToken) {
  // The implicit flow's MBI_SSL-scoped token needs the "t=" RPS ticket
  // prefix (vs. "d=" for XboxLive.signin-scoped tokens from a code flow).
  const res = await timedFetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName: 'user.auth.xboxlive.com',
        RpsTicket: `t=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  });
  if (!res.ok) throw new Error(`Xbox Live authentication failed (${res.status})`);
  const json = await res.json();
  return { token: json.Token, uhs: json.DisplayClaims.xui[0].uhs };
}

async function authXsts(xblToken) {
  const res = await timedFetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (json.XErr === 2148916233) {
      throw new Error('На этом Microsoft-аккаунте нет профиля Xbox Live. Создайте его на xbox.com.');
    }
    if (json.XErr === 2148916238) {
      throw new Error('Это детский аккаунт — нужно разрешение через семейную группу Microsoft.');
    }
    throw new Error(`Error авторизации XSTS (${res.status})`);
  }
  return { token: json.Token, uhs: json.DisplayClaims.xui[0].uhs };
}

async function authMinecraft(xstsToken, uhs) {
  const res = await timedFetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` }),
  });
  if (!res.ok) throw new Error(`Error авторизации в Minecraft (${res.status})`);
  return res.json(); // { access_token, expires_in, ... }
}

// Mojang's profile API returns skin/cape texture URLs as plain http://,
// which our renderer's CSP (https: only, for mixed-content safety) silently
// blocks — the 3D preview then fails with a generic "couldn't load texture"
// error. The same textures.minecraft.net resources are also served over
// https, so just upgrade the scheme.
function toHttpsUrl(url) {
  return url ? url.replace(/^http:/, 'https:') : url;
}

async function getMinecraftProfile(mcAccessToken) {
  const res = await timedFetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });
  if (res.status === 404) {
    throw new Error('На этом Microsoft-аккаунте не куплен Minecraft.');
  }
  if (!res.ok) throw new Error(`Failed получить профиль Minecraft (${res.status})`);
  return res.json(); // { id, name, skins, capes }
}

// Pulls the bits of a Mojang /minecraft/profile response we care about into
// our account shape. Reused both right after login and after any cosmetic
// change (skin/cape) so the stored account always reflects what Mojang has.
function cosmeticsFromProfile(profile) {
  const activeSkin = (profile.skins || []).find((s) => s.state === 'ACTIVE');
  return {
    skinUrl: toHttpsUrl(activeSkin?.url) || null,
    skinVariant: (activeSkin?.variant || 'CLASSIC').toLowerCase() === 'slim' ? 'slim' : 'classic',
    capes: (profile.capes || []).map((c) => ({
      id: c.id,
      alias: c.alias,
      state: c.state,
      url: toHttpsUrl(c.url),
    })),
  };
}

// msTokens: { access_token, refresh_token? } straight from the Live token
// endpoint (or a bare access-token string).
async function finishLoginChainFromMsAccessToken(msTokens, onStatus) {
  const msAccessToken = typeof msTokens === 'string' ? msTokens : msTokens.access_token;
  const msRefreshToken = typeof msTokens === 'string' ? null : (msTokens.refresh_token || null);
  onStatus?.('Вход в Xbox Live…');
  const xbl = await authXboxLive(msAccessToken);

  onStatus?.('Получение токена XSTS…');
  const xsts = await authXsts(xbl.token);

  onStatus?.('Вход в Minecraft Services…');
  const mc = await authMinecraft(xsts.token, xsts.uhs);
  const profile = await getMinecraftProfile(mc.access_token);

  return {
    type: 'microsoft',
    id: profile.id,
    name: profile.name,
    ...cosmeticsFromProfile(profile),
    minecraftAccessToken: mc.access_token,
    minecraftAccessTokenExpiresAt: Date.now() + mc.expires_in * 1000,
    msRefreshToken,
  };
}

// Silently renews a Microsoft account's Minecraft session from its stored
// refresh token. Returns the updated account (same id, new tokens); throws
// with err.needsRelogin when there's no usable refresh token.
async function refreshAccount(account, onStatus) {
  if (!account.msRefreshToken) {
    const err = new Error('Microsoft session expired — войдите в аккаунт заново.');
    err.needsRelogin = true;
    throw err;
  }
  const ms = await refreshLiveToken(account.msRefreshToken);
  const fresh = await finishLoginChainFromMsAccessToken(
    { access_token: ms.access_token, refresh_token: ms.refresh_token || account.msRefreshToken },
    onStatus,
  );
  // Keep our stored identity/fields; take the new tokens + cosmetics.
  return { ...account, ...fresh, id: account.id };
}

function makeOfflineAccount(username) {
  // Deterministic "offline" UUID from the username, same scheme Mojang used
  // pre-1.16 for offline-mode servers. Only works against offline/cracked
  // servers or singleplayer — not a real Mojang/Xbox account.
  const crypto = require('crypto');
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.toString('hex');
  const uuid = `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
  return {
    type: 'offline',
    id: uuid,
    name: username,
    skinUrl: null,
    minecraftAccessToken: '0',
  };
}

module.exports = {
  buildLiveAuthUrl,
  isRedirectUrl,
  extractAccessTokenFromUrl,
  extractAuthCodeFromUrl,
  exchangeAuthCode,
  refreshAccount,
  finishLoginChainFromMsAccessToken,
  makeOfflineAccount,
  toHttpsUrl,
  cosmeticsFromProfile,
};
