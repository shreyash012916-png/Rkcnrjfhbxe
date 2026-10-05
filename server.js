import http from 'node:http';
import { extname, join, normalize } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/[\\\/]$/, '');
const PORT = Number(process.env.PORT || 10000);
const BUILD = '3.0.0';
const JSON_LIMIT = 256 * 1024;
const sessions = new Map();
const ALLOWED_ACTIONS = new Set(['pump_on','pump_off','auto_on','auto_off','machine_on','machine_off','emergency_stop']);

const PUBLIC_FILES = new Set(['index.html','styles.css','app.js','icon.svg']);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const contentType = headers['Content-Type'] || (Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json; charset=utf-8');
  res.writeHead(status, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  res.end(data);
}

async function readJson(req, limit = JSON_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Invalid JSON.'), { statusCode: 400 }); }
}

function safePath(urlPath) {
  let decoded;
  try { decoded = decodeURIComponent((urlPath || '/').split('?')[0]); }
  catch { return null; }
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (!PUBLIC_FILES.has(relative)) return null;
  const candidate = normalize(join(ROOT, relative));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + '/')) return null;
  return candidate;
}

async function staticFile(urlPath, res) {
  const path = safePath(urlPath);
  if (!path) return send(res, 403, { ok: false, error: 'Forbidden.' });
  try {
    const data = await readFile(path);
    return send(res, 200, data, { 'Content-Type': MIME[extname(path).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  } catch (error) {
    if (error?.code === 'ENOENT') return send(res, 404, { ok: false, error: 'Not found.' });
    return send(res, 500, { ok: false, error: 'Could not read resource.' });
  }
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStatus(raw = {}) {
  const ag = raw.agriculture || {};
  const ind = raw.industry || {};
  return {
    agriculture: {
      online: Boolean(ag.online),
      soil: num(ag.soil),
      waterTank: num(ag.waterTank),
      temperature: num(ag.temperature),
      humidity: num(ag.humidity),
      pump: Boolean(ag.pump),
      auto: Boolean(ag.auto),
      available: Array.isArray(ag.available) ? ag.available.slice(0, 12).map(String) : [],
    },
    industry: {
      online: Boolean(ind.online),
      machine: Boolean(ind.machine),
      load: num(ind.load),
      vibration: num(ind.vibration),
      temperature: num(ind.temperature),
      camera: Boolean(ind.camera || ind.cameraUrl),
      available: Array.isArray(ind.available) ? ind.available.slice(0, 12).map(String) : [],
    },
  };
}

function action(zone, value) {
  return { zone, action: value };
}

function addUnique(arr, item) {
  const key = item.zone + ':' + item.action;
  if (!arr.some(x => x.zone + ':' + x.action === key)) arr.push(item);
}

function hasAny(text, words) { return words.some(w => text.includes(w)); }

function planAgriculture(status, brief = '') {
  const a = status.agriculture;
  const plan = [];
  const lines = [];
  const availableText = a.available.length ? a.available.join(', ') : 'No component inventory was reported by the controller.';
  const hasPump = a.available.length ? a.available.some(x => /pump|water/i.test(x)) : (a.pump !== null);
  const hasAuto = a.available.length ? a.available.some(x => /automatic|auto/i.test(x)) : (a.auto !== null);
  lines.push('Agriculture plan — based on the systems ORBITA can see right now.');
  lines.push(a.online ? '1. Field controller is online, so live telemetry can be used.' : '1. Field controller is offline, so keep the plan advisory until the ESP32 reconnects.');
  lines.push(`Available agriculture systems: ${availableText}.`);

  if (a.soil !== null) {
    lines.push(`2. Soil moisture is ${a.soil}%. ${a.soil < 35 ? 'That is below the current dry threshold, so irrigation is needed.' : a.soil > 60 ? 'Moisture is comfortable, so extra watering is not currently needed.' : 'Moisture is in the middle range, so keep monitoring.'}`);
    if (a.online && a.soil < 35 && hasPump && a.waterTank !== 0 && a.waterTank !== null) addUnique(plan, action('agriculture', 'pump_on'));
  } else lines.push('2. Soil moisture is unavailable; do not infer wet/dry conditions without a reading.');

  if (a.waterTank !== null) {
    lines.push(`3. Water reserve is ${a.waterTank}%. ${a.waterTank < 15 ? 'Reserve is low, so avoid extended irrigation.' : 'Reserve is sufficient for normal exhibit operation.'}`);
  } else lines.push('3. Water reserve is not reported by the current controller.');

  lines.push(hasAuto ? `4. Automatic irrigation is ${a.auto ? 'enabled' : 'disabled'}. The ESP32 should remain responsible for the moisture-threshold decision.` : '4. Automatic irrigation is not reported as an available subsystem, so do not assume it exists.');
  if (a.online && !a.auto && hasAuto) addUnique(plan, action('agriculture', 'auto_on'));
  lines.push('5. Observe one telemetry refresh after any control change, then confirm the field state verbally.');
  if (brief) lines.push('6. Mission brief context is loaded; any explicit exhibition instructions should override optional demonstration steps.');
  return { title: 'AGRICULTURE / LIVE PLAN', lines, actions: plan };
}

function statusReply(status, briefLoaded) {
  const a = status.agriculture;
  const i = status.industry;
  const parts = [];
  parts.push(`Agriculture is ${a.online ? 'online' : 'offline'}${a.soil !== null ? `, soil moisture is ${a.soil}%` : ''}${a.auto ? ', automatic irrigation is enabled' : ''}.`);
  parts.push(`Industry is ${i.online ? 'online' : 'offline'}${i.load !== null ? `, machine load is ${i.load}%` : ''}${i.camera ? ', and the camera link is available' : ''}.`);
  if (briefLoaded) parts.push('Your mission brief is loaded, so I can use it when you ask about the exhibition plan.');
  return parts.join(' ');
}

function buildAgent(message, statusRaw, brief = '', history = [], lastPlan = null) {
  const raw = String(message || '').trim();
  const text = raw.toLowerCase();
  const status = normalizeStatus(statusRaw);
  const actions = [];
  let plan = null;

  if (!raw) return { reply: 'I’m here. Tell me what you want to inspect, plan, or control.', actions, plan, state: 'READY' };

  const greeting = /^(hi|hello|hey|hiya|good morning|good afternoon|good evening|namaste|orbita[,.! ]*hello)/i.test(raw);
  if (greeting) return {
    reply: 'Hello. I’m ORBITA. I can talk with you, inspect the connected systems, build a plan from the live state, or carry out the control commands available to the exhibit.',
    actions, plan, state: 'READY'
  };

  if (hasAny(text, ['who are you', 'what are you', 'introduce yourself'])) return {
    reply: 'I’m ORBITA, the local mission-control agent for this exhibition. I watch the agriculture and industry zones, reason from their live telemetry, and only use control actions that the exhibit explicitly exposes.',
    actions, plan, state: 'READY'
  };

  if (hasAny(text, ['thank you', 'thanks', 'great', 'nice'])) return {
    reply: 'You’re welcome. The mission bus is ready for the next instruction.', actions, plan, state: 'READY'
  };

  if (hasAny(text, ['help', 'what can you do', 'commands', 'capabilities'])) return {
    reply: 'You can ask me to check agriculture or industry, explain the live status, create an agriculture plan, enable or disable automatic irrigation, turn the pump or machine on or off, stop the system, or answer questions from an uploaded PDF brief.',
    actions, plan, state: 'READY'
  };

  if (hasAny(text, ['plan for agriculture', 'agriculture plan', 'plan agriculture', 'farm plan', 'field plan', 'make a plan for the farm'])) {
    plan = planAgriculture(status, brief);
    const recommended = plan.actions.length ? ` The plan recommends: ${plan.actions.map(x => x.action.replaceAll('_',' ')).join(' and ')}.` : ' No hardware change is recommended from the current readings.';
    return { reply: `${plan.lines.slice(0, 5).join(' ')}${recommended} I have not changed the hardware because you asked for a plan, not an execution command.`, actions: [], plan, state: 'PLANNING' };
  }

  if (hasAny(text, ['status', 'check everything', 'everything okay', 'how is everything', 'mission status'])) return {
    reply: statusReply(status, Boolean(brief)), actions, plan, state: 'CHECKING'
  };

  if (hasAny(text, ['check agriculture', 'check the farm', 'check field', 'farm status', 'field status', 'soil status', 'is the soil dry', 'soil dry'])) {
    const a = status.agriculture;
    if (!a.online) return { reply: 'The agriculture controller is currently offline, so I can’t give you a trustworthy live soil reading. Check the ESP32 connection first.', actions, plan, state: 'LINK CHECK' };
    const soil = a.soil === null ? 'unavailable' : `${a.soil}%`;
    const verdict = a.soil === null ? '' : a.soil < 35 ? ' The field is dry by the current threshold.' : a.soil > 60 ? ' The field is comfortably moist.' : ' The field is in the middle range.';
    return { reply: `Agriculture is online. Soil moisture is ${soil}.${verdict} Pump is ${a.pump ? 'on' : 'off'} and automatic irrigation is ${a.auto ? 'enabled' : 'disabled'}.`, actions, plan, state: 'CHECKING' };
  }

  if (hasAny(text, ['industry status', 'check industry', 'factory status', 'machine status', 'check the industry'])) {
    const i = status.industry;
    if (!i.online) return { reply: 'The industry controller is offline right now, so I can’t report a live machine state.', actions, plan, state: 'LINK CHECK' };
    return { reply: `Industry is online. Machine is ${i.machine ? 'running' : 'stopped'}${i.load === null ? '' : ` at ${i.load}% load`}${i.vibration === null ? '' : ` with ${i.vibration} g vibration`}. Camera is ${i.camera ? 'available' : 'not reporting a feed'}.`, actions, plan, state: 'CHECKING' };
  }

  if (hasAny(text, ['automatic irrigation', 'auto irrigation', 'auto watering', 'automatic watering'])) {
    const enable = !hasAny(text, ['disable', 'turn off', 'switch off', 'stop automatic']);
    addUnique(actions, action('agriculture', enable ? 'auto_on' : 'auto_off'));
    return { reply: `I’ll ${enable ? 'enable' : 'disable'} automatic irrigation on the agriculture controller. The ESP32 will continue making the moisture-threshold decision itself.`, actions, plan, state: 'EXECUTING' };
  }

  if (hasAny(text, ['pump on', 'start the pump', 'turn on the pump', 'water the plants', 'start irrigation', 'start watering'])) {
    addUnique(actions, action('agriculture', 'pump_on'));
    return { reply: 'Understood. I’ll start the agriculture water pump.', actions, plan, state: 'EXECUTING' };
  }

  if (hasAny(text, ['pump off', 'stop the pump', 'turn off the pump', 'stop watering', 'stop irrigation'])) {
    addUnique(actions, action('agriculture', 'pump_off'));
    return { reply: 'Understood. I’ll stop the agriculture water pump.', actions, plan, state: 'EXECUTING' };
  }

  if (hasAny(text, ['machine on', 'start machine', 'turn on machine', 'start the machine', 'start factory'])) {
    addUnique(actions, action('industry', 'machine_on'));
    return { reply: 'Understood. I’ll start the industry machine.', actions, plan, state: 'EXECUTING' };
  }

  if (hasAny(text, ['machine off', 'stop machine', 'turn off machine', 'stop the machine'])) {
    addUnique(actions, action('industry', 'machine_off'));
    return { reply: 'Understood. I’ll stop the industry machine.', actions, plan, state: 'EXECUTING' };
  }

  if (hasAny(text, ['emergency stop', 'stop everything', 'halt everything', 'shut everything down'])) {
    addUnique(actions, action('industry', 'emergency_stop'));
    addUnique(actions, action('agriculture', 'pump_off'));
    return { reply: 'Emergency stop requested. I’ll stop the industry machine and shut off the agriculture pump.', actions, plan, state: 'EXECUTING' };
  }

  if (hasAny(text, ['according to the pdf', 'according to the brief', 'according to the document', 'what does the plan say', 'what does the pdf say', 'use the pdf', 'use the brief'])) {
    if (!brief) return { reply: 'I don’t have a mission brief loaded yet. Upload the PDF and I’ll use its extracted instructions in our conversation.', actions, plan, state: 'WAITING' };
    const excerpt = brief.replace(/\s+/g, ' ').slice(0, 420);
    return { reply: `The mission brief is loaded. The relevant extracted context begins: ${excerpt}${brief.length > 420 ? ' …' : ''}`, actions, plan, state: 'DOCUMENT' };
  }

  const last = history.at(-1)?.text || '';
  if (lastPlan?.actions?.length && hasAny(text, ['do it', 'go ahead', 'execute the plan', 'apply the plan', 'start the plan'])) {
    const approved = lastPlan.actions.filter(x => ALLOWED_ACTIONS.has(x.action) && (x.zone === 'agriculture' || x.zone === 'industry')).slice(0, 5);
    return { reply: `Understood. I’ll apply the live agriculture plan now: ${approved.map(x => x.action.replaceAll('_',' ')).join(' and ')}.`, actions: approved, plan: null, state: 'EXECUTING' };
  }
  if (last && hasAny(text, ['repeat that', 'say that again', 'what did you say'])) {
    return { reply: history.at(-1)?.text || 'I don’t have a previous response to repeat.', actions, plan, state: 'READY' };
  }
  if (last && hasAny(text, ['yes', 'okay', 'ok'])) {
    return { reply: 'I’m ready to continue, but I need the specific action so I don’t guess about a physical system.', actions, plan, state: 'CLARIFY' };
  }

  if (brief && hasAny(text, ['brief', 'pdf', 'document', 'instructions', 'according to'])) {
    const terms = text.split(/[^a-z0-9]+/).filter(w => w.length > 3 && !['what','does','should','according','brief','document','instructions','tell','about','this'].includes(w));
    const sentences = brief.split(/[.!?\n]+/).map(x => x.trim()).filter(Boolean);
    const ranked = sentences.map(sentence => ({ sentence, score: terms.reduce((n, t) => n + (sentence.toLowerCase().includes(t) ? 1 : 0), 0) })).sort((a,b) => b.score-a.score);
    if (ranked[0]?.score) return { reply: `From the uploaded brief, the closest relevant instruction I found is: ${ranked[0].sentence.slice(0, 700)}.`, actions, plan, state: 'DOCUMENT' };
  }

  return {
    reply: `I understand the request, but I don’t want to guess about a physical system. I can check live status, create an agriculture plan from the available hardware, use your mission brief, or execute the exhibit’s defined pump, irrigation, machine, and stop commands.`,
    actions, plan, state: 'CLARIFY'
  };
}

async function handleAgent(req, res) {
  try {
    const body = await readJson(req);
    const result = buildAgent(body.message, body.status, String(body.brief || '').slice(0, 12000), Array.isArray(body.history) ? body.history.slice(-10) : [], body.lastPlan);
    return send(res, 200, { ok: true, ...result, engine: 'ORBITA LOCAL CORE', build: BUILD });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok: false, error: error.message || 'Agent error.' });
  }
}

async function handlePdfText(req, res) {
  // The browser performs PDF.js extraction locally. This endpoint stores only the text sent by the browser.
  try {
    const body = await readJson(req, 64 * 1024);
    const text = String(body.text || '').replace(/\u0000/g, '').trim();
    if (!text) return send(res, 400, { ok: false, error: 'No readable text was extracted from the PDF.' });
    return send(res, 200, {
      ok: true,
      characters: Math.min(text.length, 12000),
      summary: text.slice(0, 12000),
      title: String(body.name || 'Mission brief').slice(0, 120),
      engine: 'LOCAL PDF TEXT',
    });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok: false, error: error.message || 'PDF upload failed.' });
  }
}

function handleHealth(_req, res) {
  return send(res, 200, { ok: true, name: 'ORBITA', build: BUILD, engine: 'local', gemini: false, uptime: Math.round(process.uptime()), time: new Date().toISOString() });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://orbita.local');
    if (req.method === 'GET' && url.pathname === '/api/health') return handleHealth(req, res);
    if (req.method === 'POST' && url.pathname === '/api/agent') return handleAgent(req, res);
    if (req.method === 'POST' && url.pathname === '/api/pdf-text') return handlePdfText(req, res);
    if (req.method === 'GET') return staticFile(url.pathname, res);
    return send(res, 405, { ok: false, error: 'Method not allowed.' }, { Allow: 'GET, POST' });
  } catch (error) {
    return send(res, error.statusCode || 500, { ok: false, error: error.message || 'Server error.' });
  }
});

server.on('clientError', (_error, socket) => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
server.listen(PORT, '0.0.0.0', () => console.log(`ORBITA ${BUILD} listening on http://0.0.0.0:${PORT}`));
