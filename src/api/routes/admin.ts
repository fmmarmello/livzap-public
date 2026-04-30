import { Router } from 'express';
import { issueAdminToken, requireAdminSession } from '../middleware/auth';
import { settingsService } from '../../services/settings.service';
import {
  assertStrongApiKey,
  assertValidChatId,
  assertValidInstanceId,
  normalizeNewsletterId,
  parseBool,
  parseIntWithBounds,
  parseCsv,
} from '../../utils/validation';
import { instanceManager } from '../../client/instance-manager';
import { discoverService } from '../../services/discover.service';
import { eventFeedService } from '../../services/event-feed.service';
import { buildSignedResourceQuery } from '../middleware/auth';
import { authRateLimit } from '../middleware/rate-limit';

const router = Router();

function serializeSettings() {
  const settings = settingsService.get();
  return {
    ...settings,
    security: {
      ...settings.security,
      apiKey: settings.security.apiKey ? '***' : '',
      signedUrlSecret: settings.security.signedUrlSecret ? '***' : '',
    },
  };
}

function getAdminHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LivZap Admin</title>
  <style>
    :root { --bg:#f7f8fa; --panel:#fff; --line:#d7dbe3; --text:#122034; --accent:#0f766e; --danger:#b91c1c; }
    body { margin:0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; background: radial-gradient(circle at top right, #dff3f0, var(--bg)); color:var(--text); }
    .wrap { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
    .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:16px; box-shadow:0 8px 24px rgba(15,23,42,0.06);}
    h1,h2 { margin: 0 0 12px; }
    .row { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:10px; }
    input,select,button,textarea { font: inherit; padding:10px; border:1px solid var(--line); border-radius:10px; }
    input,select,textarea { flex:1; min-width: 180px; }
    button { background:var(--accent); color:#fff; border:none; cursor:pointer; }
    button.danger { background:var(--danger); }
    table { width:100%; border-collapse: collapse; }
    th,td { border-bottom:1px solid var(--line); padding:8px; text-align:left; font-size:14px; }
    #app { display:none; }
    #status { font-size:13px; opacity:0.8; }
    .muted { opacity:0.75; font-size:12px; }
    @media (max-width: 700px){ .row { flex-direction:column; } }
  </style>
</head>
<body>
  <div class="wrap">
    <div id="login" class="card">
      <h1>LivZap Admin</h1>
      <p class="muted">Authenticate with API key to start a short admin session.</p>
      <div class="row">
        <input id="apiKey" type="password" placeholder="API key" />
        <button id="loginBtn">Login</button>
      </div>
      <div id="loginStatus"></div>
    </div>

    <div id="app">
      <div class="card">
        <h2>Security + Runtime Settings</h2>
        <div class="row">
          <select id="securityMode"><option>strict</option><option>balanced</option><option>relaxed</option></select>
          <input id="allowedOrigins" placeholder="allowed origins (csv)" />
          <select id="mediaSourceMode"><option>https_only</option><option>https_and_local</option></select>
          <input id="mediaDomains" placeholder="media domains allowlist (csv)" />
        </div>
        <div class="row">
          <select id="antiBanProfile"><option>conservative</option><option>moderate</option><option>custom</option></select>
          <input id="globalPerMin" type="number" placeholder="global/min" />
          <input id="chatPerMin" type="number" placeholder="per-chat/min" />
          <input id="cooldownMs" type="number" placeholder="cooldown ms" />
        </div>
        <div class="row">
          <input id="webhookUrl" placeholder="webhook url" />
          <input id="webhookEvents" placeholder="webhook events (csv)" />
          <button id="saveSettingsBtn">Save settings</button>
        </div>
      </div>

      <div class="card">
        <h2>Instances</h2>
        <div class="row">
          <input id="newInstanceId" placeholder="instance id" />
          <button id="createInstanceBtn">Create instance</button>
          <button id="refreshBtn">Refresh</button>
        </div>
        <table><thead><tr><th>ID</th><th>Status</th><th>Phone</th><th>Actions</th></tr></thead><tbody id="instancesTable"></tbody></table>
        <div class="row">
          <img id="qrImage" alt="QR code" style="max-width:280px; border-radius:10px; border:1px solid var(--line)" />
        </div>
      </div>

      <div class="card">
        <h2>Send Test Message</h2>
        <div class="row">
          <input id="testInstanceId" placeholder="instance id" />
          <input id="testChatId" placeholder="chat id (e.g. 5511...@c.us)" />
          <input id="testText" placeholder="message text" />
          <button id="sendTestBtn">Send</button>
        </div>
      </div>

      <div class="card">
        <h2>Recent Events</h2>
        <button id="refreshEventsBtn">Refresh Events</button>
        <pre id="events" style="white-space:pre-wrap; font-size:12px;"></pre>
      </div>
      <div id="status"></div>
    </div>
  </div>
  <script>
    const loginEl = document.getElementById('login');
    const appEl = document.getElementById('app');
    const statusEl = document.getElementById('status');
    let token = '';
    const setStatus = (msg) => { statusEl.textContent = msg; };
    const headers = () => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token });

    async function api(path, method='GET', body){
      const res = await fetch(path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
      const data = await res.json().catch(() => ({}));
      if(!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    }

    async function loadSettings(){
      const data = await api('/api/admin/settings');
      const s = data.settings;
      document.getElementById('securityMode').value = s.security.securityMode;
      document.getElementById('allowedOrigins').value = (s.security.allowedOrigins || []).join(',');
      document.getElementById('mediaSourceMode').value = s.security.mediaSourceMode;
      document.getElementById('mediaDomains').value = (s.security.mediaAllowedDomains || []).join(',');
      document.getElementById('antiBanProfile').value = s.antiBan.profile;
      document.getElementById('globalPerMin').value = s.antiBan.maxGlobalPerMinute;
      document.getElementById('chatPerMin').value = s.antiBan.maxPerChatPerMinute;
      document.getElementById('cooldownMs').value = s.antiBan.cooldownMs;
      document.getElementById('webhookUrl').value = s.webhook.url || '';
      document.getElementById('webhookEvents').value = (s.webhook.events || []).join(',');
    }

    async function loadInstances(){
      const data = await api('/api/admin/instances');
      const tbody = document.getElementById('instancesTable');
      tbody.innerHTML = '';
      for(const i of data.instances){
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>'+i.id+'</td><td>'+i.status+'</td><td>'+(i.phone||'')+'</td><td></td>';
        const actions = tr.querySelector('td:last-child');
        const qr = document.createElement('button'); qr.textContent='QR';
        qr.onclick = async () => {
          const r = await api('/api/admin/instances/' + encodeURIComponent(i.id) + '/qr-url');
          document.getElementById('qrImage').src = r.url;
        };
        const del = document.createElement('button'); del.textContent='Delete'; del.className='danger';
        del.onclick = async () => { await api('/api/admin/instances/' + encodeURIComponent(i.id), 'DELETE'); await loadInstances(); };
        actions.appendChild(qr); actions.appendChild(del);
        tbody.appendChild(tr);
      }
    }

    async function loadEvents(){
      const data = await api('/api/admin/events');
      document.getElementById('events').textContent = JSON.stringify(data.events, null, 2);
    }

    document.getElementById('loginBtn').onclick = async () => {
      try {
        const apiKey = document.getElementById('apiKey').value;
        const res = await fetch('/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ apiKey }) });
        const data = await res.json();
        if(!res.ok) throw new Error(data.error || 'Login failed');
        token = data.token;
        loginEl.style.display = 'none';
        appEl.style.display = 'block';
        await loadSettings();
        await loadInstances();
        await loadEvents();
      } catch (err) {
        document.getElementById('loginStatus').textContent = err.message;
      }
    };

    document.getElementById('saveSettingsBtn').onclick = async () => {
      try {
        await api('/api/admin/settings', 'PUT', {
          security: {
            securityMode: document.getElementById('securityMode').value,
            allowedOrigins: document.getElementById('allowedOrigins').value,
            mediaSourceMode: document.getElementById('mediaSourceMode').value,
            mediaAllowedDomains: document.getElementById('mediaDomains').value
          },
          antiBan: {
            profile: document.getElementById('antiBanProfile').value,
            maxGlobalPerMinute: Number(document.getElementById('globalPerMin').value),
            maxPerChatPerMinute: Number(document.getElementById('chatPerMin').value),
            cooldownMs: Number(document.getElementById('cooldownMs').value)
          },
          webhook: {
            url: document.getElementById('webhookUrl').value,
            events: document.getElementById('webhookEvents').value
          }
        });
        setStatus('Settings saved');
      } catch (err) {
        setStatus(err.message);
      }
    };

    document.getElementById('createInstanceBtn').onclick = async () => {
      try {
        await api('/api/admin/instances', 'POST', { id: document.getElementById('newInstanceId').value });
        await loadInstances();
      } catch (err) { setStatus(err.message); }
    };

    document.getElementById('refreshBtn').onclick = async () => { await loadInstances(); };
    document.getElementById('refreshEventsBtn').onclick = async () => { await loadEvents(); };
    document.getElementById('sendTestBtn').onclick = async () => {
      try {
        await api('/api/admin/send-test', 'POST', {
          instanceId: document.getElementById('testInstanceId').value,
          chatId: document.getElementById('testChatId').value,
          text: document.getElementById('testText').value
        });
        setStatus('Test message queued');
      } catch (err) { setStatus(err.message); }
    };
  </script>
</body>
</html>`;
}

router.get('/', (req, res) => {
  if (!settingsService.get().security.adminEnabled) {
    res.status(404).json({ error: 'Admin UI disabled' });
    return;
  }
  if (req.baseUrl.includes('/api/admin')) {
    res.json({ name: 'LivZap Admin API', status: 'ok' });
    return;
  }
  res.type('html').send(getAdminHtml());
});

router.post('/login', authRateLimit, (req, res) => {
  if (!settingsService.get().security.adminEnabled) {
    res.status(404).json({ error: 'Admin UI disabled' });
    return;
  }
  const expectedApiKey = settingsService.get().security.apiKey;
  const apiKey = String(req.body?.apiKey || req.headers['x-api-key'] || '');
  if (!apiKey || apiKey !== expectedApiKey) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  const session = issueAdminToken();
  res.json({ token: session.token, expiresInMs: session.expiresInMs });
});

router.get('/settings', requireAdminSession, (_req, res) => {
  res.json({ settings: serializeSettings() });
});

router.put('/settings', requireAdminSession, async (req, res) => {
  const current = settingsService.get();
  const patch = req.body || {};

  const securityPatch = patch.security || {};
  const webhookPatch = patch.webhook || {};
  const antiBanPatch = patch.antiBan || {};
  const instanceDefaultsPatch = patch.instanceDefaults || {};

  const nextApiKey =
    typeof securityPatch.apiKey === 'string' && securityPatch.apiKey.trim()
      ? securityPatch.apiKey.trim()
      : current.security.apiKey;
  if (nextApiKey !== current.security.apiKey) {
    assertStrongApiKey(nextApiKey);
  }

  await settingsService.update({
    security: {
      ...current.security,
      apiKey: nextApiKey,
      securityMode:
        securityPatch.securityMode === 'strict' ||
        securityPatch.securityMode === 'balanced' ||
        securityPatch.securityMode === 'relaxed'
          ? securityPatch.securityMode
          : current.security.securityMode,
      adminEnabled: parseBool(securityPatch.adminEnabled, current.security.adminEnabled),
      allowedOrigins:
        typeof securityPatch.allowedOrigins === 'string'
          ? parseCsv(securityPatch.allowedOrigins)
          : Array.isArray(securityPatch.allowedOrigins)
            ? securityPatch.allowedOrigins
            : current.security.allowedOrigins,
      mediaSourceMode:
        securityPatch.mediaSourceMode === 'https_and_local'
          ? 'https_and_local'
          : securityPatch.mediaSourceMode === 'https_only'
            ? 'https_only'
            : current.security.mediaSourceMode,
      mediaAllowedDomains:
        typeof securityPatch.mediaAllowedDomains === 'string'
          ? parseCsv(securityPatch.mediaAllowedDomains)
          : Array.isArray(securityPatch.mediaAllowedDomains)
            ? securityPatch.mediaAllowedDomains
            : current.security.mediaAllowedDomains,
    },
    webhook: {
      ...current.webhook,
      url: typeof webhookPatch.url === 'string' ? webhookPatch.url.trim() : current.webhook.url,
      secret:
        typeof webhookPatch.secret === 'string' ? webhookPatch.secret.trim() : current.webhook.secret,
      events:
        typeof webhookPatch.events === 'string'
          ? parseCsv(webhookPatch.events)
          : Array.isArray(webhookPatch.events)
            ? webhookPatch.events
            : current.webhook.events,
      timeoutMs: parseIntWithBounds(
        webhookPatch.timeoutMs,
        current.webhook.timeoutMs,
        1000,
        60000,
      ),
      maxRetries: parseIntWithBounds(webhookPatch.maxRetries, current.webhook.maxRetries, 1, 10),
    },
    antiBan: {
      ...current.antiBan,
      profile:
        antiBanPatch.profile === 'conservative' ||
        antiBanPatch.profile === 'moderate' ||
        antiBanPatch.profile === 'custom'
          ? antiBanPatch.profile
          : current.antiBan.profile,
      minDelayMs: parseIntWithBounds(antiBanPatch.minDelayMs, current.antiBan.minDelayMs, 0, 30000),
      maxDelayMs: parseIntWithBounds(antiBanPatch.maxDelayMs, current.antiBan.maxDelayMs, 0, 60000),
      typingByDefault: parseBool(antiBanPatch.typingByDefault, current.antiBan.typingByDefault),
      maxGlobalPerMinute: parseIntWithBounds(
        antiBanPatch.maxGlobalPerMinute,
        current.antiBan.maxGlobalPerMinute,
        1,
        1000,
      ),
      maxPerChatPerMinute: parseIntWithBounds(
        antiBanPatch.maxPerChatPerMinute,
        current.antiBan.maxPerChatPerMinute,
        1,
        500,
      ),
      failureThreshold: parseIntWithBounds(
        antiBanPatch.failureThreshold,
        current.antiBan.failureThreshold,
        1,
        20,
      ),
      cooldownMs: parseIntWithBounds(antiBanPatch.cooldownMs, current.antiBan.cooldownMs, 1000, 3600000),
      maxQueueSize: parseIntWithBounds(antiBanPatch.maxQueueSize, current.antiBan.maxQueueSize, 10, 5000),
    },
    instanceDefaults: {
      ...current.instanceDefaults,
      headless: parseBool(instanceDefaultsPatch.headless, current.instanceDefaults.headless),
      protocolTimeoutMs: parseIntWithBounds(
        instanceDefaultsPatch.protocolTimeoutMs,
        current.instanceDefaults.protocolTimeoutMs,
        10000,
        600000,
      ),
      authTimeoutMs: parseIntWithBounds(
        instanceDefaultsPatch.authTimeoutMs,
        current.instanceDefaults.authTimeoutMs,
        10000,
        600000,
      ),
      autoReconnect: parseBool(instanceDefaultsPatch.autoReconnect, current.instanceDefaults.autoReconnect),
    },
  });

  res.json({ success: true, settings: serializeSettings(), updatedAt: new Date().toISOString() });
});

router.get('/instances', requireAdminSession, (_req, res) => {
  res.json({ instances: instanceManager.listInstances() });
});

router.post('/instances', requireAdminSession, (req, res) => {
  const { id, headless, protocolTimeoutMs, authTimeoutMs, autoReconnect } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  try {
    const safeId = assertValidInstanceId(String(id));
    const defaults = settingsService.get().instanceDefaults;
    const instance = instanceManager.createInstance({
      id: safeId,
      headless: parseBool(headless, defaults.headless),
      protocolTimeoutMs: parseIntWithBounds(
        protocolTimeoutMs,
        defaults.protocolTimeoutMs,
        10000,
        600000,
      ),
      authTimeoutMs: parseIntWithBounds(authTimeoutMs, defaults.authTimeoutMs, 10000, 600000),
      autoReconnect: parseBool(autoReconnect, defaults.autoReconnect),
    });
    instance.initialize();
    res.status(201).json({ success: true, instance: { id: instance.id, status: instance.status } });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/instances/:id', requireAdminSession, async (req, res) => {
  try {
    const safeId = assertValidInstanceId(String(req.params.id));
    const removed = await instanceManager.removeInstance(safeId);
    if (!removed) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/instances/:id/qr-url', requireAdminSession, (req, res) => {
  try {
    const safeId = assertValidInstanceId(String(req.params.id));
    const signed = buildSignedResourceQuery(`qr:${safeId}`);
    const url = `/api/instances/${encodeURIComponent(safeId)}/qr?exp=${signed.exp}&sig=${signed.sig}`;
    res.json({ url, expiresAt: new Date(signed.exp).toISOString() });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/send-test', requireAdminSession, async (req, res) => {
  const { instanceId, chatId, text, newsletterId } = req.body || {};
  if (!instanceId || !(chatId || newsletterId) || !text) {
    res.status(400).json({ error: 'instanceId + (chatId or newsletterId) + text are required' });
    return;
  }
  try {
    const safeInstanceId = assertValidInstanceId(String(instanceId));
    const instance = instanceManager.getInstance(safeInstanceId);
    if (!instance) {
      res.status(404).json({ error: 'Instance not found' });
      return;
    }

    if (newsletterId) {
      const safeNewsletterId = normalizeNewsletterId(String(newsletterId));
      const result = await instance.sendToNewsletter({ newsletterId: safeNewsletterId, text: String(text) });
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, mode: 'newsletter' });
      return;
    }

    const safeChatId = assertValidChatId(String(chatId));
    const result = await instance.sendMessage({ chatId: safeChatId, text: String(text) });
    if (!result.success) {
      res.status(400).json(result);
      return;
    }
    res.json({ success: true, mode: 'chat', messageId: result.messageId });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/events', requireAdminSession, (req, res) => {
  const instanceId = req.query.instanceId ? String(req.query.instanceId) : '';
  let recentMessages: any[] = [];
  if (instanceId) {
    try {
      const safe = assertValidInstanceId(instanceId);
      recentMessages = discoverService.getRecentMessages(safe, 3600000, 50, 'all');
    } catch {
      recentMessages = [];
    }
  }
  res.json({
    events: eventFeedService.list(200),
    discover: recentMessages,
  });
});

export default router;
