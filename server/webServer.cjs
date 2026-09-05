const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const { createProjectStore } = require('../electron/services/projectStore.cjs');
const { createDesignPipeline } = require('../electron/services/designPipeline.cjs');
const { createFlowStateRepair } = require('../electron/services/flowStateRepair.cjs');
const { createIntentStateStore } = require('../electron/services/intentStateStore.cjs');
const { createGalleryStore, isDownloadAllowed, hasDownloadWaiver, blockedDownloadMessage } = require('../electron/services/galleryStore.cjs');
const { hashBuffer, resolveProjectPath } = require('../electron/services/compositionRenderer.cjs');
const { assertFinalDeliveryReady } = require('../electron/services/finalDeliveryGate.cjs');
const { assistantEnabled, loadKunpoConfig, saveModelConfig } = require('../electron/services/env.cjs');
const kunpoClient = require('../electron/services/kunpoClient.cjs');
const { ERROR_CODES } = require('../electron/services/errorCodes.cjs');
const { createAssistantRuntime } = require('../electron/services/assistantRuntime.cjs');

const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_SESSION_COOKIE_NAME = 'design_copilot_session';
const DEFAULT_OAUTH_COOKIE_NAME = 'design_copilot_oauth';
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

// v1.4 §11.2：Intent 业务错误码 → HTTP 状态。并发/陈旧/已取代类映射 409，
// 校验/门禁类映射 422，历史不存在映射 404；请求体超限由 readBody 直接 413。
const INTENT_HTTP_STATUS = {
  [ERROR_CODES.INTENT_REVISION_CONFLICT]: 409,
  [ERROR_CODES.INTENT_CANDIDATE_REPLACEMENT_REQUIRED]: 409,
  [ERROR_CODES.INTENT_CANDIDATE_STALE]: 409,
  [ERROR_CODES.INTENT_REQUEST_SUPERSEDED]: 409,
  [ERROR_CODES.INTENT_ANALYSIS_STALE]: 409,
  [ERROR_CODES.INTENT_GENERATION_INTERRUPTED]: 409,
  [ERROR_CODES.INTENT_REVIEW_INCOMPLETE]: 422,
  [ERROR_CODES.INTENT_ANALYSIS_INVALID]: 422,
  [ERROR_CODES.INTENT_HISTORY_LIMIT_REACHED]: 422,
  [ERROR_CODES.INTENT_HISTORY_VERSION_NOT_FOUND]: 404
};

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signValue(value, secret) {
  const encoded = base64url(JSON.stringify(value));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySignedValue(value, secret) {
  if (typeof value !== 'string') return null;
  const index = value.lastIndexOf('.');
  if (index < 1) return null;
  const encoded = value.slice(0, index);
  const provided = value.slice(index + 1);
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(provided, 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try { return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}

function safeJson(value) {
  return `${JSON.stringify(value)}\n`;
}

async function atomicJson(filePath, value, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  await fs.writeFile(temporary, safeJson(value), { encoding: 'utf8', mode });
  await fs.rename(temporary, filePath);
}

async function readJson(filePath, fallback = null) {
  try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return fallback;
    throw error;
  }
}

class IdentityStore {
  constructor(root, secret) {
    this.root = root;
    this.secret = secret;
    this.indexPath = path.join(root, 'identities.json');
    this.sessionsRoot = path.join(root, 'sessions');
  }

  subjectKey(tenantKey, openId) {
    return crypto.createHmac('sha256', this.secret).update(`${tenantKey}\0${openId}`).digest('hex');
  }

  async tenantFor(tenantKey, openId) {
    const subject = this.subjectKey(tenantKey, openId);
    const index = await readJson(this.indexPath, { schema_version: '1.0', identities: {} });
    let tenantId = index.identities[subject];
    if (!tenantId) {
      tenantId = crypto.randomUUID();
      index.identities[subject] = tenantId;
      await atomicJson(this.indexPath, index);
    }
    return tenantId;
  }

  async createSession(tenantId) {
    const sessionId = crypto.randomBytes(32).toString('base64url');
    const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    await atomicJson(path.join(this.sessionsRoot, `${sessionHash}.json`), {
      schema_version: '1.0',
      tenant_id: tenantId,
      expires_at: Date.now() + SESSION_TTL_SECONDS * 1000
    });
    return sessionId;
  }

  async readSession(sessionId) {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(sessionId || '')) return null;
    const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    const session = await readJson(path.join(this.sessionsRoot, `${sessionHash}.json`), null);
    if (!session || session.expires_at <= Date.now()) {
      await fs.unlink(path.join(this.sessionsRoot, `${sessionHash}.json`)).catch(() => undefined);
      return null;
    }
    return session;
  }

  async destroySession(sessionId) {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(sessionId || '')) return;
    const sessionHash = crypto.createHash('sha256').update(sessionId).digest('hex');
    await fs.unlink(path.join(this.sessionsRoot, `${sessionHash}.json`)).catch(() => undefined);
  }
}

function sanitizeForClient(value, workspaceLabel = '在线工作区') {
  if (Array.isArray(value)) return value.map((item) => sanitizeForClient(item, workspaceLabel));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'workspacePath') result[key] = workspaceLabel;
    else if (key === 'wireframe_path') result[key] = child ? 'inputs/wireframe' : child;
    else if (key === 'path' && typeof child === 'string' && path.isAbsolute(child)) result[key] = path.basename(child);
    else if (key === 'reference_paths' && Array.isArray(child)) result[key] = child.map((item) => path.basename(item));
    else result[key] = sanitizeForClient(child, workspaceLabel);
  }
  return result;
}

function safeStaticPath(distRoot, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const resolved = path.resolve(distRoot, relative);
  const root = path.resolve(distRoot);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function contentType(filePath) {
  const types = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.ico': 'image/x-icon'
  };
  return types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function securityHeaders(response, publicUrl) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://kunpoapiimg.ziy.cc", "connect-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'self' https://accounts.feishu.cn"
  ].join('; '));
  if (publicUrl.protocol === 'https:') response.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(safeJson(value));
}

function redirect(response, location, cookies = []) {
  response.statusCode = 302;
  response.setHeader('Location', location);
  response.setHeader('Cache-Control', 'no-store');
  if (cookies.length) response.setHeader('Set-Cookie', cookies);
  response.end();
}

async function readBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('请求内容超过允许大小。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(request, maxBytes = MAX_JSON_BYTES) {
  const body = await readBody(request, maxBytes);
  if (!body.length) return {};
  try { return JSON.parse(body.toString('utf8')); }
  catch {
    const error = new Error('请求 JSON 格式无效。');
    error.status = 400;
    throw error;
  }
}

function loginPage(configured) {
  const title = configured ? '使用飞书登录' : '登录配置待完成';
  const copy = configured
    ? '项目数据将按飞书账号隔离保存。登录仅获取应用内稳定身份，不申请通讯录、邮箱或手机号权限。'
    : '服务已部署，但尚未安全注入 FEISHU_APP_ID 与 FEISHU_APP_SECRET。完成飞书应用配置后即可登录。';
  const action = configured ? '<a href="/auth/feishu/start">继续使用飞书登录</a>' : '<span>请联系应用管理员完成配置</span>';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef4f8;color:#17313b;font:15px/1.7 system-ui}.card{width:min(520px,calc(100vw - 48px));padding:38px;border:1px solid #d9e5ea;border-radius:18px;background:#fff;box-shadow:0 24px 70px #1936421f}.brand{color:#087f76;font-size:13px;font-weight:800;letter-spacing:.12em}h1{margin:10px 0 12px;font-size:28px}p{margin:0 0 26px;color:#5b7079}a,span{display:inline-block;padding:11px 18px;border-radius:9px;background:#0b9b8d;color:#fff;text-decoration:none;font-weight:750}span{background:#7a8d95}</style></head><body><main class="card"><div class="brand">GAME UI DESIGN COPILOT</div><h1>${title}</h1><p>${copy}</p>${action}</main></body></html>`;
}

function configuredCookieName(environment, key, fallback) {
  const value = environment[key] === undefined ? fallback : String(environment[key]);
  if (!COOKIE_NAME_PATTERN.test(value)) {
    throw new Error(`${key} 必须是非空且不含分隔符或控制字符的 Cookie 名。`);
  }
  return value;
}

function validateConfiguration(environment) {
  const publicUrl = new URL(environment.PUBLIC_URL || `http://${environment.HOST || '127.0.0.1'}:${environment.PORT || '9030'}`);
  const dataRoot = path.resolve(environment.DESIGN_COPILOT_DATA_ROOT || '/var/lib/game-ui-design-copilot-online');
  const sessionSecret = String(environment.SESSION_SECRET || '');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET 必须至少为 32 个字符。');
  const sessionCookieName = configuredCookieName(environment, 'SESSION_COOKIE_NAME', DEFAULT_SESSION_COOKIE_NAME);
  const oauthCookieName = configuredCookieName(environment, 'OAUTH_COOKIE_NAME', DEFAULT_OAUTH_COOKIE_NAME);
  if (sessionCookieName === oauthCookieName) throw new Error('SESSION_COOKIE_NAME 与 OAUTH_COOKIE_NAME 必须不同。');
  return {
    host: environment.HOST || '127.0.0.1',
    port: Number(environment.PORT || 9030),
    publicUrl,
    dataRoot,
    distRoot: path.resolve(environment.DESIGN_COPILOT_DIST_ROOT || path.join(__dirname, '..', 'dist')),
    appId: String(environment.FEISHU_APP_ID || '').trim(),
    appSecret: String(environment.FEISHU_APP_SECRET || '').trim(),
    redirectUri: String(environment.FEISHU_REDIRECT_URI || new URL('/auth/feishu/callback', publicUrl).toString()),
    sessionSecret,
    sessionCookieName,
    oauthCookieName,
    releaseId: String(environment.DESIGN_COPILOT_RELEASE_ID || 'development').trim() || 'development',
    versionLabel: String(environment.DESIGN_COPILOT_VERSION_LABEL || '单版本').trim() || '单版本',
    secureCookie: publicUrl.protocol === 'https:'
  };
}

function createApplication(environment = process.env) {
  const config = validateConfiguration(environment);
  const features = Object.freeze({ assistant: assistantEnabled(environment) });
  const identityStore = new IdentityStore(path.join(config.dataRoot, 'identity'), config.sessionSecret);
  const contexts = new Map();

  function tenantContext(tenantId) {
    if (contexts.has(tenantId)) return contexts.get(tenantId);
    const tenantRoot = path.join(config.dataRoot, 'tenants', tenantId);
    const workspaceRoot = path.join(tenantRoot, 'user', 'Game UI Design Projects');
    const modelConfigPath = path.join(tenantRoot, 'user', 'settings', 'models.json');
    const projectRoot = path.join(__dirname, '..');
    const projectStore = createProjectStore({ workspaceRoot });
    // v1.4 PR-I1：Intent 状态存储接入同一项目写锁（每租户一个进程实例）。
    const intentStateStore = createIntentStateStore({ projectStore });
    projectStore.__attachIntentStore(intentStateStore);
    const kunpoConfig = loadKunpoConfig(projectRoot, environment, { modelConfigPath });
    const galleryStore = createGalleryStore({
      workspaceRoot,
      projectStore,
      isTrustedCdnUrl: (url) => kunpoClient.isTrustedKunpoCdnUrl(url)
    });
    const designPipeline = createDesignPipeline({ projectStore, kunpoClient, kunpoConfig, intentStateStore, galleryStore });
    const flowStateRepair = createFlowStateRepair({ projectStore });
    const assistantRuntime = features.assistant ? createAssistantRuntime({
      assistantRoot: path.join(tenantRoot, 'assistant'), kunpoConfig, kunpoClient,
      projectStore, intentStateStore, enabled: true
    }) : null;
    const context = { tenantRoot, workspaceRoot, modelConfigPath, projectRoot, projectStore, intentStateStore, kunpoConfig, designPipeline, flowStateRepair, galleryStore, assistantRuntime };
    contexts.set(tenantId, context);
    return context;
  }

  async function sessionFor(request) {
    const sessionId = parseCookies(request.headers.cookie)[config.sessionCookieName] || '';
    const session = await identityStore.readSession(sessionId);
    return { sessionId, session };
  }

  function enforceOrigin(request) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && origin !== config.publicUrl.origin) {
      const error = new Error('请求来源不受信任。');
      error.status = 403;
      throw error;
    }
  }

  async function handleAuth(request, response, url) {
    const configured = Boolean(config.appId && config.appSecret);
    if (url.pathname === '/auth/status') {
      const { session } = await sessionFor(request);
      return sendJson(response, 200, { loggedIn: Boolean(session), configured });
    }
    if (url.pathname === '/auth/feishu/start' && request.method === 'GET') {
      if (!configured) return response.end(loginPage(false));
      const state = crypto.randomBytes(24).toString('base64url');
      const stateCookie = signValue({ state, expiresAt: Date.now() + STATE_TTL_SECONDS * 1000 }, config.sessionSecret);
      const authorize = new URL('https://accounts.feishu.cn/open-apis/authen/v1/authorize');
      authorize.searchParams.set('client_id', config.appId);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('redirect_uri', config.redirectUri);
      authorize.searchParams.set('state', state);
      return redirect(response, authorize.toString(), [cookie(config.oauthCookieName, stateCookie, { maxAge: STATE_TTL_SECONDS, secure: config.secureCookie })]);
    }
    if (url.pathname === '/auth/feishu/callback' && request.method === 'GET') {
      const stateCookie = verifySignedValue(parseCookies(request.headers.cookie)[config.oauthCookieName], config.sessionSecret);
      const state = url.searchParams.get('state') || '';
      if (!stateCookie || stateCookie.expiresAt <= Date.now() || stateCookie.state !== state) {
        const error = new Error('飞书登录状态校验失败，请重新登录。');
        error.status = 400;
        throw error;
      }
      if (url.searchParams.get('error')) {
        const error = new Error('飞书登录已取消。');
        error.status = 401;
        throw error;
      }
      const code = url.searchParams.get('code') || '';
      if (!code) {
        const error = new Error('飞书回调缺少授权码。');
        error.status = 400;
        throw error;
      }
      const tokenResponse = await fetch('https://accounts.feishu.cn/oauth/v3/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ grant_type: 'authorization_code', client_id: config.appId, client_secret: config.appSecret, code, redirect_uri: config.redirectUri })
      });
      const token = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || token.code !== 0 || !token.access_token) throw new Error('飞书授权凭证交换失败。');
      const userResponse = await fetch('https://open.feishu.cn/open-apis/authen/v1/user_info', {
        headers: { Authorization: `Bearer ${token.access_token}` }
      });
      const user = await userResponse.json().catch(() => ({}));
      if (!userResponse.ok || user.code !== 0 || !user.data?.tenant_key || !user.data?.open_id) throw new Error('飞书用户身份读取失败。');
      const tenantId = await identityStore.tenantFor(user.data.tenant_key, user.data.open_id);
      const sessionId = await identityStore.createSession(tenantId);
      return redirect(response, '/', [
        cookie(config.sessionCookieName, sessionId, { maxAge: SESSION_TTL_SECONDS, secure: config.secureCookie }),
        cookie(config.oauthCookieName, '', { maxAge: 0, secure: config.secureCookie })
      ]);
    }
    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      enforceOrigin(request);
      const { sessionId } = await sessionFor(request);
      await identityStore.destroySession(sessionId);
      response.setHeader('Set-Cookie', cookie(config.sessionCookieName, '', { maxAge: 0, secure: config.secureCookie }));
      return sendJson(response, 200, { ok: true });
    }
    return false;
  }

  async function handleApi(request, response, url, session) {
    enforceOrigin(request);
    const context = tenantContext(session.tenant_id);
    const { projectStore, intentStateStore, designPipeline, kunpoConfig, assistantRuntime } = context;
    if (url.pathname.startsWith('/api/assistant/')) response.setHeader('Cache-Control', 'no-store');
    const binaryUpload = url.pathname.endsWith('/import') || /\/assets\/(font|component|forge-manifest)$/.test(url.pathname);
    const assistantMessage = request.method === 'POST' && /^\/api\/assistant\/conversations\/[^/]+\/messages$/.test(url.pathname);
    const body = ['POST', 'PUT', 'PATCH'].includes(request.method) && !binaryUpload ? await readJsonBody(request, assistantMessage ? 17 * 1024 * 1024 : MAX_JSON_BYTES) : {};
    let value;
    if (request.method === 'GET' && url.pathname === '/api/config') {
      value = { kunpo: kunpoClient.safeConfig(kunpoConfig), workspaceRoot: '在线工作区（当前飞书账号）', platform: 'web', features };
    } else if (request.method === 'POST' && url.pathname === '/api/config/models') {
      const saved = saveModelConfig(context.projectRoot, body, environment, { modelConfigPath: context.modelConfigPath });
      kunpoConfig.visionModel = saved.visionModel;
      kunpoConfig.critiqueModel = saved.critiqueModel;
      kunpoConfig.imageModel = saved.imageModel;
      kunpoConfig.assistantModel = saved.assistantModel;
      kunpoConfig.modelSource = path.basename(saved.modelConfigPath);
      value = { kunpo: kunpoClient.safeConfig(kunpoConfig), workspaceRoot: '在线工作区（当前飞书账号）', platform: 'web', features };
    } else if (url.pathname.startsWith('/api/assistant/')) {
      if (!assistantRuntime) throw Object.assign(new Error('内嵌助手当前已关闭。'), { code: ERROR_CODES.ASSISTANT_DISABLED, status: 404 });
      const rootPath = '/api/assistant/conversations';
      if (request.method === 'GET' && url.pathname === rootPath) value = await assistantRuntime.listConversations();
      else if (request.method === 'POST' && url.pathname === rootPath) value = await assistantRuntime.createConversation(body);
      else {
        const match = url.pathname.match(/^\/api\/assistant\/conversations\/([^/]+)(?:\/(messages)|\/runs\/([^/]+)\/(confirm|cancel))?$/);
        if (!match) return false;
        const conversationId = decodeURIComponent(match[1]);
        if (request.method === 'GET' && !match[2] && !match[3]) value = await assistantRuntime.openConversation(conversationId);
        else if (request.method === 'PATCH' && !match[2] && !match[3]) value = await assistantRuntime.renameConversation(conversationId, body);
        else if (request.method === 'DELETE' && !match[2] && !match[3]) value = await assistantRuntime.deleteConversation(conversationId);
        else if (request.method === 'POST' && match[2] === 'messages') value = await assistantRuntime.sendMessage(conversationId, body);
        else if (request.method === 'POST' && match[3] && match[4] === 'confirm') value = await assistantRuntime.confirmAction(conversationId, decodeURIComponent(match[3]), body.actionId);
        else if (request.method === 'POST' && match[3] && match[4] === 'cancel') value = await assistantRuntime.cancelAction(conversationId, decodeURIComponent(match[3]), body.actionId);
        else return false;
      }
    } else if (request.method === 'GET' && url.pathname === '/api/gallery') {
      // 图库是租户级资源：路由必须先于 /api/projects 解析（§7.3）。
      const query = {};
      for (const [key, value] of url.searchParams) query[key] = value;
      value = await context.galleryStore.list(query);
    } else if (request.method === 'POST' && /^\/api\/gallery\/[^/]+\/(hide|restore|waive)$/.test(url.pathname)) {
      const [, assetId, action] = url.pathname.match(/^\/api\/gallery\/([^/]+)\/(hide|restore|waive)$/);
      const decodedId = decodeURIComponent(assetId);
      if (action === 'waive') value = await context.galleryStore.waiveDownload(decodedId, body.reason);
      else value = action === 'hide' ? await context.galleryStore.hide(decodedId) : await context.galleryStore.restore(decodedId);
    } else if (request.method === 'GET' && /^\/api\/gallery\/[^/]+\/download$/.test(url.pathname)) {
      const assetId = decodeURIComponent(url.pathname.slice('/api/gallery/'.length, -'/download'.length));
      const asset = await context.galleryStore.getDownloadAsset(assetId);
      // §7.5：门禁只认登记时的 continuation_mode 快照（缺失即 fail-closed），
      // 不得依赖前端禁用，也不读取项目当前路线；已留痕豁免的历史快照放行。
      if (!isDownloadAllowed(asset) && !hasDownloadWaiver(asset)) throw Object.assign(new Error(blockedDownloadMessage(asset)), { status: 409 });
      if (!kunpoClient.isTrustedKunpoCdnUrl(asset.cdn_url)) throw Object.assign(new Error('该图片来源不是可信的永久 CDN 资产。'), { status: 409 });
      const upstream = await fetch(asset.cdn_url);
      if (!upstream.ok || !upstream.body) throw Object.assign(new Error('下载图库原图失败。'), { status: 502 });
      const contentType = String(upstream.headers.get('content-type') || '');
      if (!/^image\/(png|jpe?g|webp)/i.test(contentType)) throw Object.assign(new Error('下载图库原图失败：上游内容类型异常。'), { status: 502 });
      // 同源代理流式转发，绝不把远端 URL 重定向给浏览器（§7.3）。
      const sanitize = (part) => String(part || '').replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'gallery';
      const dateStamp = String(asset.created_at || '').slice(0, 10);
      const extension = (/\.(png|jpe?g|webp)$/i.exec(new URL(asset.cdn_url).pathname)?.[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
      const displayName = `${sanitize(asset.project_name_snapshot)}-${sanitize(asset.screen_name_snapshot)}-${sanitize(asset.strategy || asset.origin_kind)}-${dateStamp}.${extension}`;
      const asciiName = displayName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').trim() || `gallery-${dateStamp}.${extension}`;
      response.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(displayName)}`,
        'Cache-Control': 'private, no-store'
      });
      await pipeline(upstream.body, response);
      return true;
    } else if (request.method === 'GET' && url.pathname === '/api/projects') value = await projectStore.list();
    else if (request.method === 'POST' && url.pathname === '/api/projects') value = await projectStore.create(body);
    else {
      const match = url.pathname.match(/^\/api\/projects\/([^/]+)(.*)$/);
      if (!match) return false;
      const projectId = decodeURIComponent(match[1]);
      const suffix = match[2];
      if (request.method === 'GET' && suffix === '') value = await projectStore.open(projectId, { includePreviews: url.searchParams.get('includePreviews') !== 'false', ...(url.searchParams.get('screenId') ? { screenId: url.searchParams.get('screenId') } : {}) });
      else if (request.method === 'PATCH' && suffix === '') {
        const before = await projectStore.open(projectId, { screenId: body.screenId });
        const saved = await projectStore.saveProject(projectId, body);
        value = await designPipeline.invalidateFromInputChange(projectId, {
          requirement: before.requirement !== saved.requirement,
          artDirection: before.art_direction !== saved.art_direction,
          projectType: before.project_type !== saved.project_type,
          continuationMode: before.continuation_mode !== saved.continuation_mode,
          screenId: body.screenId || saved.screen_id
        });
      } else if (request.method === 'POST' && suffix === '/duplicate') value = await projectStore.duplicate(projectId);
      else if (request.method === 'POST' && suffix === '/import') {
        const kind = url.searchParams.get('kind');
        if (!['wireframe', 'reference'].includes(kind)) throw Object.assign(new Error('无效的图片类型。'), { status: 400 });
        const fileName = decodeURIComponent(String(request.headers['x-file-name'] || 'upload.png'));
        if (!/\.(png|jpe?g|webp)$/i.test(fileName)) throw Object.assign(new Error('只允许 PNG、JPG 或 WebP 图片。'), { status: 415 });
        const bytes = await readBody(request, MAX_IMAGE_BYTES);
        const uploadRoot = path.join(context.tenantRoot, 'data', 'uploads', '.incoming');
        await fs.mkdir(uploadRoot, { recursive: true, mode: 0o700 });
        const temporary = path.join(uploadRoot, `${crypto.randomUUID()}${path.extname(fileName).toLowerCase()}`);
        await fs.writeFile(temporary, bytes, { mode: 0o600 });
        try {
          await projectStore.importFile(projectId, temporary, kind, { screenId: url.searchParams.get('screenId') });
          await designPipeline.invalidateFromInputChange(projectId, { wireframe: kind === 'wireframe', references: kind === 'reference', screenId: url.searchParams.get('screenId') || undefined });
          value = await projectStore.open(projectId);
        } finally { await fs.unlink(temporary).catch(() => undefined); }
      } else if (request.method === 'POST' && suffix === '/reference') {
        // AUD-07：与桌面端一致——无变化的 blur/重复操作是 no-op，不得失效
        // Style/Visual 下游链。
        const { changed } = await projectStore.manageReference(projectId, body);
        if (changed) await designPipeline.invalidateFromInputChange(projectId, { references: true });
        value = await projectStore.open(projectId);
      } else if (request.method === 'POST' && (suffix === '/assets/font' || suffix === '/assets/component' || suffix === '/assets/forge-manifest')) {
        const assetKind = suffix.endsWith('/font') ? 'font' : suffix.endsWith('/forge-manifest') ? 'forge-manifest' : 'component';
        const fileName = decodeURIComponent(String(request.headers['x-file-name'] || 'asset.bin'));
        const allowed = assetKind === 'font' ? /\.(otf|ttf)$/i : assetKind === 'forge-manifest' ? /\.json$/i : /\.(png|jpe?g|webp|svg)$/i;
        if (!allowed.test(fileName)) throw Object.assign(new Error(`Invalid ${assetKind} asset type.`), { status: 415 });
        let metadata = {};
        try { metadata = JSON.parse(url.searchParams.get('meta') || '{}'); } catch { throw Object.assign(new Error('Invalid asset metadata.'), { status: 400 }); }
        const bytes = await readBody(request, MAX_IMAGE_BYTES);
        const uploadRoot = path.join(context.tenantRoot, 'data', 'uploads', '.incoming');
        await fs.mkdir(uploadRoot, { recursive: true, mode: 0o700 });
        const temporary = path.join(uploadRoot, `${crypto.randomUUID()}${path.extname(fileName).toLowerCase()}`);
        await fs.writeFile(temporary, bytes, { mode: 0o600 });
        try { value = assetKind === 'font' ? await designPipeline.addFontAsset(projectId, temporary, metadata) : assetKind === 'forge-manifest' ? await designPipeline.addForgeManifest(projectId, temporary) : await designPipeline.addComponentAsset(projectId, temporary, metadata); }
        finally { await fs.unlink(temporary).catch(() => undefined); }
      } else if (request.method === 'POST' && suffix === '/fonts/confirm') value = await designPipeline.confirmFontUsage(projectId, body);
      else if (request.method === 'GET' && /^\/fonts\/[^/]+\/bytes$/.test(suffix)) {
        const fontId = decodeURIComponent(suffix.split('/')[2]);
        const project = await projectStore.open(projectId, { includePreviews: false });
        const font = (project.artifacts.fontManifest?.fonts || []).find((item) => item.id === fontId);
        if (!font) throw Object.assign(new Error('Font not found.'), { status: 404 });
        const bytes = await fs.readFile(resolveProjectPath(project.workspacePath, font.local_path));
        if (hashBuffer(bytes) !== font.file_hash) throw Object.assign(new Error('Font asset hash changed.'), { status: 409 });
        response.writeHead(200, { 'Content-Type': font.format === 'otf' ? 'font/otf' : 'font/ttf', 'Content-Length': bytes.length, 'Cache-Control': 'private, no-store' });
        response.end(bytes);
        return true;
      } else if (request.method === 'GET' && suffix === '/screens') value = await projectStore.listScreens(projectId);
      else if (request.method === 'POST' && suffix === '/screens') value = await projectStore.createScreen(projectId, body);
      else if (request.method === 'POST' && /^\/screens\/[^/]+\/duplicate$/.test(suffix)) value = await projectStore.duplicateScreen(projectId, decodeURIComponent(suffix.split('/')[2]), body);
      else if (request.method === 'POST' && suffix === '/screens/active') value = await projectStore.setActiveScreen(projectId, body.screenId);
      else if (request.method === 'PATCH' && suffix.startsWith('/screens/')) value = await projectStore.updateScreen(projectId, decodeURIComponent(suffix.slice('/screens/'.length)), body);
      else if (request.method === 'POST' && suffix === '/pipeline/run') value = await designPipeline.runStage(projectId, body.stage, body.input);
      else if (request.method === 'POST' && suffix === '/requirement/draft') value = await designPipeline.draftRequirement(projectId, body);
      // v1.4 §11.1：structured-v2 Intent 同义接口，与桌面端调用同一
      // pipeline / intentStateStore 业务方法；mutation 后统一回传最新项目。
      else if (request.method === 'POST' && suffix === '/intent/generate') {
        await designPipeline.prefillIntent(projectId, body);
        value = await projectStore.open(projectId, { screenId: body.screenId });
      } else if (request.method === 'POST' && suffix === '/intent/review/save') {
        await intentStateStore.saveIntentReview(projectId, body.screenId, body);
        value = await projectStore.open(projectId, { screenId: body.screenId });
      } else if (request.method === 'POST' && suffix === '/intent/review/confirm') {
        await intentStateStore.confirmIntentReview(projectId, body.screenId, body);
        value = await projectStore.open(projectId, { screenId: body.screenId });
      } else if (request.method === 'POST' && suffix === '/intent/candidate/adopt') {
        await intentStateStore.adoptIntentCandidate(projectId, body.screenId, body);
        value = await projectStore.open(projectId, { screenId: body.screenId });
      } else if (request.method === 'POST' && suffix === '/intent/candidate/discard') {
        await intentStateStore.discardIntentCandidate(projectId, body.screenId, body);
        value = await projectStore.open(projectId, { screenId: body.screenId });
      } else if (request.method === 'GET' && suffix === '/intent/candidate') {
        value = await intentStateStore.getIntentCandidate(projectId, url.searchParams.get('screenId'));
      } else if (request.method === 'GET' && suffix === '/intent/history') {
        value = await intentStateStore.listIntentHistory(projectId, url.searchParams.get('screenId'));
      } else if (request.method === 'POST' && suffix === '/intent/history/restore') {
        await intentStateStore.restoreIntentHistory(projectId, body.screenId, body);
        value = await projectStore.open(projectId, { screenId: body.screenId });
      } else if (request.method === 'POST' && suffix === '/intent/history/delete') {
        await intentStateStore.deleteIntentHistory(projectId, body.screenId, body);
        value = await projectStore.open(projectId, { screenId: body.screenId });
      } else if (request.method === 'POST' && suffix === '/pipeline/cancel') value = await designPipeline.cancelStage(projectId, body.stage, body);
      else if (request.method === 'POST' && suffix === '/pipeline/approve') value = await designPipeline.approveArtifact(projectId, body.kind, body.input);
      else if (request.method === 'POST' && suffix === '/pipeline/repair-route-cycle') value = await context.flowStateRepair.repairRouteCycle(projectId, body).then(() => projectStore.open(projectId, { includePreviews: false, screenId: body.screenId }));
      else if (request.method === 'PATCH' && suffix === '/artifact') value = await designPipeline.updateArtifact(projectId, body.kind, body.patch);
      else if (request.method === 'POST' && suffix === '/underlay/contract') value = await designPipeline.createUnderlayContract(projectId, body);
      else if (request.method === 'POST' && suffix === '/underlay/guide') value = await designPipeline.createLayoutGuide(projectId, body);
      else if (request.method === 'POST' && suffix === '/underlay/critique') value = await designPipeline.critiqueUnderlay(projectId, body);
      else if (request.method === 'POST' && suffix === '/underlay/repair') value = await designPipeline.repairUnderlay(projectId, body);
      else if (request.method === 'POST' && suffix === '/underlay/waiver') value = await designPipeline.waiveUnderlayIssue(projectId, body);
      else if (request.method === 'POST' && suffix === '/underlay/manual-review') value = await designPipeline.approveUnderlayManualReview(projectId, body);
      else if (request.method === 'POST' && suffix === '/composition') value = await designPipeline.composeVisual(projectId, body);
      else if (request.method === 'POST' && suffix === '/fidelity') value = await designPipeline.runFidelity(projectId, body);
      else if (request.method === 'GET' && suffix.startsWith('/visual/')) {
        const variationId = decodeURIComponent(suffix.slice('/visual/'.length));
        // P1-03：下载 URL 可携带调用时冻结的 Screen，避免多会话下 Active
        // Screen 被其它会话切换后打开错误 Screen 的交付证据。
        const visualScreenId = url.searchParams.get('screenId') || undefined;
        const project = await projectStore.open(projectId, { includePreviews: false, ...(visualScreenId ? { screenId: visualScreenId } : {}) });
        const strict = project.continuation_mode === 'existing-strict' || project.continuation_mode === 'locked-continuation';
        if (strict) {
          const output = project.artifacts.compositionOutput;
          // WEB-DELIVERY-01：Web 直接 URL 就是正式交付边界，必须与桌面端
          // 共用同一最终交付门禁：未过 Fidelity / 未最终批准 / 视觉绑定
          // 漂移 / Output 像素异常均返回 409，禁止未签核成图外流。
          await assertFinalDeliveryReady({ project, projectPath: project.workspacePath });
          const bytes = await fs.readFile(resolveProjectPath(project.workspacePath, output.path));
          response.writeHead(200, {
            'Content-Type': 'image/png',
            'Content-Length': bytes.length,
            'Content-Disposition': `attachment; filename="${project.screen_id.replace(/[^A-Za-z0-9_-]/g, '')}-final.png"`,
            'Cache-Control': 'private, no-store',
            'X-Content-SHA256': output.hash
          });
          response.end(bytes);
          return true;
        }
        const variation = (project.artifacts.visualResults?.variations || []).find((item) => item.id === variationId);
        if (!variation?.image_url || !kunpoClient.isTrustedKunpoCdnUrl(variation.image_url)) throw Object.assign(new Error('未找到可信的视觉方案。'), { status: 404 });
        const upstream = await fetch(variation.image_url);
        if (!upstream.ok || !upstream.body) throw new Error('下载视觉方案失败。');
        response.writeHead(200, {
          'Content-Type': upstream.headers.get('content-type') || 'image/png',
          'Content-Disposition': `attachment; filename="visual-${variationId.replace(/[^A-Za-z0-9_-]/g, '')}.png"`,
          'Cache-Control': 'private, no-store'
        });
        await pipeline(upstream.body, response);
        return true;
      } else return false;
    }
    sendJson(response, 200, sanitizeForClient(value));
    return true;
  }

  async function handler(request, response) {
    securityHeaders(response, config.publicUrl);
    const url = new URL(request.url, config.publicUrl);
    try {
      if (url.pathname === '/healthz') {
        return sendJson(response, 200, {
          status: 'ok',
          service: 'game-ui-design-copilot',
          releaseId: config.releaseId,
          versionLabel: config.versionLabel
        });
      }
      if (url.pathname.startsWith('/auth/')) {
        const handled = await handleAuth(request, response, url);
        if (handled !== false) return;
      }
      const { session } = await sessionFor(request);
      if (url.pathname.startsWith('/api/')) {
        if (!session) return sendJson(response, 401, { error: 'authentication_required' });
        const handled = await handleApi(request, response, url, session);
        if (!handled) return sendJson(response, 404, { error: 'not_found' });
        return;
      }
      if (!session) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return response.end(loginPage(Boolean(config.appId && config.appSecret)));
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method_not_allowed' });
      let filePath = safeStaticPath(config.distRoot, url.pathname);
      if (!filePath) return sendJson(response, 404, { error: 'not_found' });
      let stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) {
        filePath = path.join(config.distRoot, 'index.html');
        stat = await fs.stat(filePath).catch(() => null);
      }
      if (!stat?.isFile()) return sendJson(response, 503, { error: 'frontend_not_built' });
      response.writeHead(200, { 'Content-Type': contentType(filePath), 'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable' });
      if (request.method === 'HEAD') return response.end();
      response.end(await fs.readFile(filePath));
    } catch (error) {
      const status = Number(error.status) || INTENT_HTTP_STATUS[error.code] || 500;
      if (!response.headersSent) sendJson(response, status, { error: status >= 500 && !error.code ? 'internal_error' : error.message, ...(error.code ? { code: error.code } : {}), ...(error.stage ? { stage: error.stage } : {}), ...(error.missing_requirements ? { missing_requirements: error.missing_requirements } : {}) });
      else response.destroy();
      const safeMessage = String(error?.message || 'unknown error').replace(/[?&](code|state|token)=[^&\s]+/gi, '$1=[redacted]');
      console.error(`[web] ${request.method} ${url.pathname} ${status}: ${safeMessage}`);
    }
  }

  return { config, handler, identityStore, tenantContext };
}

if (require.main === module) {
  const application = createApplication(process.env);
  const server = http.createServer(application.handler);
  server.requestTimeout = 22 * 60 * 1000;
  server.headersTimeout = 30 * 1000;
  server.listen(application.config.port, application.config.host, () => {
    console.log(`[web] listening on ${application.config.host}:${application.config.port}`);
  });
}

module.exports = { IdentityStore, createApplication, safeStaticPath, sanitizeForClient, signValue, verifySignedValue };
