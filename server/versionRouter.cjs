const http = require('node:http');
const { pipeline } = require('node:stream/promises');

const VERSION_COOKIE_DEFAULT = 'design_copilot_version';
const CLASSIC_SESSION_COOKIE_DEFAULT = 'design_copilot_session';
const VERSION_VALUES = new Set(['classic', 'current']);
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const ROUTER_BODY_LIMIT = 8 * 1024;
const HEALTH_BODY_LIMIT = 64 * 1024;
const DEFAULT_HTML_LIMIT = 1024 * 1024;
const DEFAULT_UPSTREAM_TIMEOUT = 22 * 60 * 1000;
const DEFAULT_HEALTH_TIMEOUT = 2000;
const VERSION_CONTROL_CSS = `#design-copilot-version-control{position:fixed;left:14px;bottom:128px;z-index:2147483647;color:#f8fafc;font:13px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}#design-copilot-version-control *{box-sizing:border-box}#design-copilot-version-control a{padding:0;border:0;border-radius:0;background:transparent;color:inherit;font-weight:inherit;text-decoration:none}#design-copilot-version-control span{display:block;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font-weight:inherit}#design-copilot-version-control .vc-orb{position:relative;display:grid;place-items:center;width:44px;height:44px;border:1px solid rgba(148,163,184,.32);border-radius:50%;background:rgba(15,23,42,.94);box-shadow:0 10px 30px rgba(15,23,42,.35);color:#e2e8f0;text-decoration:none;backdrop-filter:blur(14px);transition:transform .16s ease,border-color .16s ease}#design-copilot-version-control .vc-orb:hover{transform:scale(1.06);border-color:rgba(148,163,184,.5)}#design-copilot-version-control .vc-dot{position:absolute;top:2px;right:2px;width:9px;height:9px;border-radius:50%;box-shadow:0 0 0 2px rgba(15,23,42,.94)}#design-copilot-version-control[data-version="current"] .vc-dot{background:#38bdf8}#design-copilot-version-control[data-version="classic"] .vc-dot{background:#0b9b8d}#design-copilot-version-control .vc-menu{position:absolute;left:0;bottom:calc(100% + 10px);width:206px;padding:8px;border:1px solid rgba(148,163,184,.28);border-radius:12px;background:rgba(15,23,42,.94);box-shadow:0 18px 50px rgba(15,23,42,.34);backdrop-filter:blur(14px);opacity:0;visibility:hidden;pointer-events:none;transform:translateY(6px);transform-origin:left bottom;transition:opacity .16s ease,transform .16s ease,visibility 0s linear .16s}#design-copilot-version-control .vc-menu::after{content:'';position:absolute;top:100%;left:0;width:52px;height:14px}#design-copilot-version-control:hover .vc-menu,#design-copilot-version-control:focus-within .vc-menu{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:opacity .16s ease,transform .16s ease,visibility 0s}#design-copilot-version-control .vc-item{display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;color:#e2e8f0;text-decoration:none}#design-copilot-version-control .vc-item:hover{background:rgba(148,163,184,.16);color:#fff}#design-copilot-version-control .vc-item svg{flex:0 0 auto;color:#7dd3fc}#design-copilot-version-control .vc-note{margin:6px 2px 2px;color:#94a3b8;font-size:11px;line-height:1.5}#design-copilot-version-control a:focus-visible{outline:2px solid #38bdf8;outline-offset:2px}@media(max-width:640px),(max-height:600px){#design-copilot-version-control{left:10px;bottom:16px}#design-copilot-version-control .vc-menu{width:186px}}`;
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function parseCookies(header = '') {
  const result = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const raw = part.slice(index + 1).trim();
    try { result[key] = decodeURIComponent(raw); }
    catch { result[key] = raw; }
  }
  return result;
}

function configuredCookieName(environment, key, fallback) {
  const value = environment[key] === undefined ? fallback : String(environment[key]);
  if (!COOKIE_NAME_PATTERN.test(value)) {
    throw new Error(`${key} 必须是非空且不含分隔符或控制字符的 Cookie 名。`);
  }
  return value;
}

function positiveInteger(value, fallback, key, maximum) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new Error(`${key} 必须是 1 到 ${maximum} 之间的整数。`);
  }
  return number;
}

function loopbackUpstream(value, key) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${key} 必须是有效的回环 HTTP URL。`); }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  const port = Number(url.port);
  if (url.protocol !== 'http:' || !loopback || !Number.isInteger(port) || port < 1 || port > 65535
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${key} 只允许不含凭据、路径、查询或片段的回环 HTTP origin。`);
  }
  return url;
}

function validateConfiguration(environment) {
  const host = String(environment.ROUTER_HOST || '127.0.0.1');
  if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(host)) throw new Error('ROUTER_HOST 只允许回环或全接口监听地址。');
  const port = positiveInteger(environment.ROUTER_PORT, 9030, 'ROUTER_PORT', 65535);
  const fallbackHost = host.includes(':') ? `[${host}]` : host;
  const publicUrl = new URL(environment.ROUTER_PUBLIC_URL || `http://${fallbackHost}:${port}`);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password
    || publicUrl.pathname !== '/' || publicUrl.search || publicUrl.hash) {
    throw new Error('ROUTER_PUBLIC_URL 必须是无凭据、路径、查询或片段的 HTTP(S) origin。');
  }
  const defaultVersion = String(environment.ROUTER_DEFAULT_VERSION || 'classic');
  if (!VERSION_VALUES.has(defaultVersion)) throw new Error('ROUTER_DEFAULT_VERSION 只允许 classic 或 current。');
  const upstreams = Object.freeze({
    classic: loopbackUpstream(environment.ROUTER_CLASSIC_UPSTREAM || 'http://127.0.0.1:9031', 'ROUTER_CLASSIC_UPSTREAM'),
    current: loopbackUpstream(environment.ROUTER_CURRENT_UPSTREAM || 'http://127.0.0.1:9032', 'ROUTER_CURRENT_UPSTREAM')
  });
  if (upstreams.classic.origin === upstreams.current.origin) {
    throw new Error('classic 与 current 必须使用不同的上游 origin。');
  }
  const versionCookieName = configuredCookieName(environment, 'ROUTER_VERSION_COOKIE_NAME', VERSION_COOKIE_DEFAULT);
  const classicSessionCookieName = configuredCookieName(environment, 'ROUTER_CLASSIC_SESSION_COOKIE_NAME', CLASSIC_SESSION_COOKIE_DEFAULT);
  if (versionCookieName === classicSessionCookieName) {
    throw new Error('ROUTER_VERSION_COOKIE_NAME 与 ROUTER_CLASSIC_SESSION_COOKIE_NAME 必须不同。');
  }
  return {
    host,
    port,
    publicUrl,
    defaultVersion,
    upstreams,
    versionCookieName,
    classicSessionCookieName,
    maxHtmlBytes: positiveInteger(environment.ROUTER_MAX_HTML_BYTES, DEFAULT_HTML_LIMIT, 'ROUTER_MAX_HTML_BYTES', 8 * 1024 * 1024),
    upstreamTimeoutMs: positiveInteger(environment.ROUTER_UPSTREAM_TIMEOUT_MS, DEFAULT_UPSTREAM_TIMEOUT, 'ROUTER_UPSTREAM_TIMEOUT_MS', 30 * 60 * 1000),
    healthTimeoutMs: positiveInteger(environment.ROUTER_HEALTH_TIMEOUT_MS, DEFAULT_HEALTH_TIMEOUT, 'ROUTER_HEALTH_TIMEOUT_MS', 30 * 1000)
  };
}

function selectVersion(request, config) {
  const cookies = parseCookies(request.headers.cookie);
  if (VERSION_VALUES.has(cookies[config.versionCookieName])) {
    return { version: cookies[config.versionCookieName], source: 'cookie' };
  }
  if (cookies[config.classicSessionCookieName]) return { version: 'classic', source: 'classic-session' };
  return { version: config.defaultVersion, source: 'default' };
}

function versionCookie(config, version) {
  return `${config.versionCookieName}=${encodeURIComponent(version)}; Path=/; HttpOnly; SameSite=Lax${config.publicUrl.protocol === 'https:' ? '; Secure' : ''}`;
}

function connectionHeaderNames(headers) {
  const value = Array.isArray(headers.connection) ? headers.connection.join(',') : String(headers.connection || '');
  return new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
}

function filteredHeaders(headers) {
  const connectionNames = connectionHeaderNames(headers);
  const result = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (value === undefined || HOP_BY_HOP_HEADERS.has(lower) || connectionNames.has(lower)) continue;
    result[lower] = value;
  }
  return result;
}

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'SAMEORIGIN');
  response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
}

function sendJson(response, status, value) {
  securityHeaders(response);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendHtml(response, status, html, extraHeaders = {}) {
  securityHeaders(response);
  const body = Buffer.from(html);
  response.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  response.end(body);
}

function sendCss(request, response, css) {
  securityHeaders(response);
  const body = Buffer.from(css);
  response.writeHead(200, {
    'Content-Type': 'text/css; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

async function readLimitedBody(request, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error('请求内容超过路由管理接口允许大小。');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function parseSelectionBody(request, body) {
  const contentType = String(request.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType === 'application/json') {
    try { return JSON.parse(body.toString('utf8') || '{}'); }
    catch {
      const error = new Error('请求 JSON 格式无效。');
      error.status = 400;
      throw error;
    }
  }
  if (!contentType || contentType === 'application/x-www-form-urlencoded') {
    return Object.fromEntries(new URLSearchParams(body.toString('utf8')));
  }
  const error = new Error('版本选择只接受 JSON 或表单请求。');
  error.status = 415;
  throw error;
}

function publicRequestHeaders(request, config) {
  const headers = filteredHeaders(request.headers);
  headers.host = config.publicUrl.host;
  headers['x-forwarded-host'] = config.publicUrl.host;
  headers['x-forwarded-proto'] = config.publicUrl.protocol.slice(0, -1);
  headers['x-forwarded-for'] = request.socket.remoteAddress || '';
  return headers;
}

function targetUrl(request, upstream, publicUrl) {
  const incoming = new URL(request.url, publicUrl);
  const target = new URL(upstream.origin);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  return target;
}

function injectHtmlBeforeBody(body, snippet) {
  const source = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const text = source.toString('utf8');
  const index = text.toLowerCase().lastIndexOf('</body>');
  if (index < 0) return null;
  return Buffer.from(`${text.slice(0, index)}${snippet}${text.slice(index)}`);
}

const VERSION_CONTROL_ICONS = {
  orb: '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/></svg>',
  switch: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  status: '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
};

function versionControlMarkup(version) {
  const currentLabel = version === 'classic' ? '经典版' : '新版';
  const targetVersion = version === 'classic' ? 'current' : 'classic';
  const targetLabel = targetVersion === 'classic' ? '经典版' : '新版';
  const orbLabel = `版本切换，当前：${escapeHtml(currentLabel)}，点击查看版本状态`;
  return `<link rel="stylesheet" href="/__versions/control.css"><aside id="design-copilot-version-control" data-version="${escapeHtml(version)}" aria-label="版本切换"><a class="vc-orb" href="/__versions" title="${orbLabel}" aria-label="${orbLabel}"><span class="vc-dot" aria-hidden="true"></span>${VERSION_CONTROL_ICONS.orb}</a><nav class="vc-menu" aria-label="版本操作"><a class="vc-item" href="/__versions/select/${escapeHtml(targetVersion)}">${VERSION_CONTROL_ICONS.switch}<span>切换到${escapeHtml(targetLabel)}</span></a><a class="vc-item" href="/__versions">${VERSION_CONTROL_ICONS.status}<span>查看版本状态</span></a><p class="vc-note">两版账号与项目数据相互独立。</p></nav></aside>`;
}

function defaultHtmlInjector(body, context) {
  return injectHtmlBeforeBody(body, versionControlMarkup(context.version));
}

function shouldBufferHtml(request, upstreamResponse, config, htmlInjector) {
  if (typeof htmlInjector !== 'function' || request.method !== 'GET') return false;
  if (Number(upstreamResponse.statusCode) < 200 || Number(upstreamResponse.statusCode) >= 300) return false;
  if (!String(upstreamResponse.headers['content-type'] || '').toLowerCase().startsWith('text/html')) return false;
  const encoding = String(upstreamResponse.headers['content-encoding'] || '').trim().toLowerCase();
  if (encoding && encoding !== 'identity') return false;
  const declared = Number(upstreamResponse.headers['content-length']);
  return !Number.isFinite(declared) || declared <= config.maxHtmlBytes;
}

function writeUpstreamHead(response, upstreamResponse, headers) {
  response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.statusMessage, headers);
}

async function forwardBufferedHtml(request, response, upstreamResponse, config, selection, htmlInjector) {
  const originalHeaders = filteredHeaders(upstreamResponse.headers);
  const chunks = [];
  let size = 0;
  let passthrough = false;
  for await (const chunk of upstreamResponse) {
    if (!passthrough && size + chunk.length > config.maxHtmlBytes) {
      passthrough = true;
      const passthroughHeaders = { ...originalHeaders };
      delete passthroughHeaders['content-length'];
      writeUpstreamHead(response, upstreamResponse, passthroughHeaders);
      for (const buffered of chunks) response.write(buffered);
    }
    size += chunk.length;
    if (passthrough) response.write(chunk);
    else chunks.push(chunk);
  }
  if (passthrough) return response.end();

  const original = Buffer.concat(chunks);
  const declared = Number(upstreamResponse.headers['content-length']);
  if (Number.isFinite(declared) && declared !== original.length) {
    writeUpstreamHead(response, upstreamResponse, originalHeaders);
    return response.end(original);
  }

  let rewritten = null;
  try {
    const candidate = await htmlInjector(original, {
      version: selection.version,
      pathname: new URL(request.url, config.publicUrl).pathname,
      contentType: upstreamResponse.headers['content-type']
    });
    if (candidate !== null && candidate !== undefined) rewritten = Buffer.isBuffer(candidate) ? candidate : Buffer.from(String(candidate));
  } catch {
    rewritten = null;
  }
  if (!rewritten) {
    writeUpstreamHead(response, upstreamResponse, originalHeaders);
    return response.end(original);
  }

  const rewrittenHeaders = { ...originalHeaders, 'content-length': String(rewritten.length) };
  delete rewrittenHeaders.etag;
  delete rewrittenHeaders['content-md5'];
  writeUpstreamHead(response, upstreamResponse, rewrittenHeaders);
  response.end(rewritten);
}

async function forwardUpstreamResponse(request, response, upstreamResponse, config, selection, htmlInjector) {
  if (request.method === 'HEAD') {
    writeUpstreamHead(response, upstreamResponse, filteredHeaders(upstreamResponse.headers));
    upstreamResponse.resume();
    return response.end();
  }
  if (shouldBufferHtml(request, upstreamResponse, config, htmlInjector)) {
    return forwardBufferedHtml(request, response, upstreamResponse, config, selection, htmlInjector);
  }
  writeUpstreamHead(response, upstreamResponse, filteredHeaders(upstreamResponse.headers));
  await pipeline(upstreamResponse, response);
}

function unavailablePage(response, version) {
  const label = version === 'classic' ? '经典版' : '新版';
  return sendHtml(response, 502, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${label}暂不可用</title></head><body><main><h1>${label}暂不可用</h1><p>路由没有把本次请求自动降级到另一版本，以避免进入错误的数据空间。</p><p><a href="/__versions">打开版本页</a></p></main></body></html>`);
}

function proxyRequest(request, response, config, selection, htmlInjector) {
  return new Promise((resolve) => {
    const target = targetUrl(request, config.upstreams[selection.version], config.publicUrl);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const upstreamRequest = http.request(target, {
      method: request.method,
      headers: publicRequestHeaders(request, config)
    }, (upstreamResponse) => {
      forwardUpstreamResponse(request, response, upstreamResponse, config, selection, htmlInjector)
        .catch(() => {
          if (!response.headersSent) unavailablePage(response, selection.version);
          else response.destroy();
        })
        .finally(finish);
    });
    upstreamRequest.setTimeout(config.upstreamTimeoutMs, () => {
      const error = new Error('upstream_timeout');
      error.code = 'ETIMEDOUT';
      upstreamRequest.destroy(error);
    });
    upstreamRequest.on('error', () => {
      request.unpipe(upstreamRequest);
      request.resume();
      if (!response.headersSent) unavailablePage(response, selection.version);
      else response.destroy();
      finish();
    });
    request.on('aborted', () => upstreamRequest.destroy());
    request.pipe(upstreamRequest);
  });
}

function healthFor(version, config) {
  return new Promise((resolve) => {
    const target = new URL('/healthz', config.upstreams[version]);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const request = http.request(target, {
      method: 'GET',
      headers: {
        host: config.publicUrl.host,
        'x-forwarded-host': config.publicUrl.host,
        'x-forwarded-proto': config.publicUrl.protocol.slice(0, -1)
      }
    }, async (response) => {
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of response) {
          size += chunk.length;
          if (size > HEALTH_BODY_LIMIT) {
            request.destroy();
            return finish({ available: false, reason: 'invalid_health_response' });
          }
          chunks.push(chunk);
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const available = response.statusCode >= 200 && response.statusCode < 300 && payload?.status === 'ok';
        finish({
          available,
          statusCode: response.statusCode,
          ...(typeof payload?.releaseId === 'string' ? { releaseId: payload.releaseId } : {}),
          ...(typeof payload?.versionLabel === 'string' ? { versionLabel: payload.versionLabel } : {}),
          ...(!available ? { reason: 'health_check_failed' } : {})
        });
      } catch {
        finish({ available: false, reason: 'invalid_health_response' });
      }
    });
    request.setTimeout(config.healthTimeoutMs, () => {
      const error = new Error('health_timeout');
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', (error) => finish({
      available: false,
      reason: error.code === 'ETIMEDOUT' ? 'timeout' : 'connection_failed'
    }));
    request.end();
  });
}

async function statusPayload(request, config) {
  const selected = selectVersion(request, config);
  const [classic, current] = await Promise.all([
    healthFor('classic', config),
    healthFor('current', config)
  ]);
  return {
    status: 'ok',
    selected,
    defaultVersion: config.defaultVersion,
    upstreams: { classic, current }
  };
}

function healthLabel(value) {
  return value.available ? '可用' : '不可用';
}

async function versionsPage(request, response, config) {
  const payload = await statusPayload(request, config);
  const selectedLabel = payload.selected.version === 'classic' ? '经典版' : '新版';
  return sendHtml(response, 200, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>版本选择</title><style>body{font:16px/1.6 system-ui;margin:40px;max-width:720px}.version-link{display:inline-block;margin-right:12px;padding:9px 14px;border-radius:8px;background:#0b9b8d;color:#fff;text-decoration:none}</style></head><body><main><h1>版本选择</h1><p>当前：${selectedLabel}</p><p>经典版：${escapeHtml(healthLabel(payload.upstreams.classic))}；新版：${escapeHtml(healthLabel(payload.upstreams.current))}</p><p>两版工作区相互独立，项目不会自动同步。</p><a class="version-link" href="/__versions/select/classic">进入经典版</a><a class="version-link" href="/__versions/select/current">进入新版</a></main></body></html>`);
}

function selectVersionResponse(response, config, version) {
  securityHeaders(response);
  response.writeHead(303, {
    Location: '/',
    'Set-Cookie': versionCookie(config, version),
    'Cache-Control': 'no-store'
  });
  response.end();
}

function createVersionRouter(environment = process.env, options = {}) {
  const config = validateConfiguration(environment);
  const htmlInjector = options.htmlInjector === undefined ? defaultHtmlInjector : options.htmlInjector;

  async function handler(request, response) {
    let url;
    try { url = new URL(request.url, config.publicUrl); }
    catch { return sendJson(response, 400, { error: 'invalid_url' }); }
    try {
      if (url.pathname === '/__versions/status') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method_not_allowed' });
        const payload = await statusPayload(request, config);
        if (request.method === 'HEAD') {
          securityHeaders(response);
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
          return response.end();
        }
        return sendJson(response, 200, payload);
      }
      if (url.pathname === '/__versions') {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
        return versionsPage(request, response, config);
      }
      if (url.pathname === '/__versions/control.css') {
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method_not_allowed' });
        return sendCss(request, response, VERSION_CONTROL_CSS);
      }
      const linkedSelection = url.pathname.match(/^\/__versions\/select\/(classic|current)$/);
      if (linkedSelection) {
        if (request.method !== 'GET') return sendJson(response, 405, { error: 'method_not_allowed' });
        return selectVersionResponse(response, config, linkedSelection[1]);
      }
      if (url.pathname === '/__versions/select') {
        if (request.method !== 'POST') return sendJson(response, 405, { error: 'method_not_allowed' });
        if (request.headers.origin !== config.publicUrl.origin) return sendJson(response, 403, { error: 'untrusted_origin' });
        const body = parseSelectionBody(request, await readLimitedBody(request, ROUTER_BODY_LIMIT));
        if (!VERSION_VALUES.has(body.version)) return sendJson(response, 400, { error: 'invalid_version' });
        return selectVersionResponse(response, config, body.version);
      }
      return proxyRequest(request, response, config, selectVersion(request, config), htmlInjector);
    } catch (error) {
      const status = Number(error.status) || 500;
      if (!response.headersSent) return sendJson(response, status, { error: status >= 500 ? 'internal_error' : error.message });
      response.destroy();
    }
  }

  return { config, handler, healthFor: (version) => healthFor(version, config), selectVersion: (request) => selectVersion(request, config) };
}

if (require.main === module) {
  const router = createVersionRouter(process.env);
  const server = http.createServer(router.handler);
  server.requestTimeout = router.config.upstreamTimeoutMs;
  server.headersTimeout = 30 * 1000;
  server.listen(router.config.port, router.config.host, () => {
    console.log(`[version-router] listening on ${router.config.host}:${router.config.port}`);
  });
}

module.exports = {
  createVersionRouter,
  defaultHtmlInjector,
  filteredHeaders,
  injectHtmlBeforeBody,
  parseCookies,
  versionControlMarkup,
  validateConfiguration
};
