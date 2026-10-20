import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ymd } from './dates.mjs';
import { modelKey, sid8 } from './session-state.mjs';
import { dentro } from './vp-rutas.mjs';
import { modeloRegistrado } from './modelo-tarjeta.mjs';

// Modelo por defecto (frontmatter) de cada agente: solo respaldo. /ejecutar y /revisar piden el modelo por llamada
// (parámetro `model` de la herramienta Agent), y SubagentStart/SubagentStop no traen el modelo en su input.
export const AGENT_MODEL = {
  arquitecto: 'opus', ejecutor: 'sonnet', revisor: 'sonnet', explorador: 'haiku', investigador: 'sonnet', 'skill-scout': 'haiku',
};
const KIND = {
  PreToolUse: 'tool', PostToolUseFailure: 'tool_fail', SubagentStart: 'subagent_start', SubagentStop: 'subagent_stop',
  PostModelSwitch: 'model', UserPromptSubmit: 'prompt', Stop: 'stop',
  // Ciclo de vida de la sesión: estado_claude (tui/hq/focus.py) los usa para seguir la sesión viva tras /clear.
  SessionStart: 'inicio', SessionEnd: 'fin',
};
// `source` (startup|resume|clear|compact) y `reason` (clear, prompt_input_exit, other...) son enums: nunca texto libre.
const ENUM_RE = /^[a-z_]{1,40}$/;
const enumOf = (v) => (typeof v === 'string' && ENUM_RE.test(v) ? v : null);
const SLUG_RE = /^[a-z0-9-]+$/;
const MAX_FIELD = 80;
const CONTROL_RUN = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]+/g;
const MAX_REDACT_INPUT = 400;
const VAL = '(?:"[^"]{0,256}"|\'[^\']{0,256}\'|\\S{1,256})';
const FLAG_RE = new RegExp(`(--?(?:password|passwd|pwd|passphrase|token|secret|api[-_]?key)(?:=|\\s+))${VAL}`, 'gi');
const ASSIGN_RE = new RegExp(`\\b([A-Za-z0-9_]{0,64}(?:key|secret|token|pass|pwd)[A-Za-z0-9_]{0,64}=)${VAL}`, 'gi');
const ENV_RE = new RegExp(`\\b([A-Z][A-Z0-9_]{2,64}=)${VAL}`, 'g');

export function redact(text) {
  return String(text ?? '')
    .slice(0, MAX_REDACT_INPUT)
    .replace(/(:\/\/[^\/\s:@]{1,64}:)[^\s]{1,128}@/g, '$1…@')
    .replace(/(:\/\/)[^\/\s@:]{6,128}@/g, '$1…@')
    .replace(/(authorization:?\s*)(?:[A-Za-z][A-Za-z-]{0,20}\s+)?[^\s"']{1,256}/gi, '$1…')
    .replace(/\b(x-api-key|api-key|x-auth-token|cookie|set-cookie):\s*[^"'\r\n]{1,256}/gi, '$1: …')
    .replace(FLAG_RE, '$1…')
    .replace(/(\s-p)(?=\S{3,})\S{1,256}/g, '$1…')
    .replace(/(sshpass\s+-p\s+)\S{1,256}/gi, '$1…')
    .replace(/(\s(?:-u|--user)(?:\s+|=)[^:\s]{1,64}:)\S{1,256}/g, '$1…')
    .replace(ASSIGN_RE, '$1…')
    .replace(ENV_RE, '$1…')
    .replace(/[A-Za-z0-9_\-+=]{32,}/g, '…');
}

function clip(text, n = MAX_FIELD) {
  const one = redact(String(text ?? '').replace(CONTROL_RUN, ' ')).replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

const str = (v) => (typeof v === 'string' ? v : '');

function relPath(p, cwd) {
  if (!p) return '';
  if (!path.isAbsolute(p) && !/^[A-Za-z]:[\\/]/.test(p)) return p;
  const rel = cwd ? path.relative(cwd, p) : '..';
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel;
  return `…/${p.split(/[\\/]/).filter(Boolean).slice(-2).join('/')}`;
}

function targetOf(tool, rawTi, cwd) {
  const ti = rawTi && typeof rawTi === 'object' && !Array.isArray(rawTi) ? rawTi : {};
  if (str(ti.file_path)) return relPath(ti.file_path, str(cwd));
  if (str(ti.notebook_path)) return relPath(ti.notebook_path, str(cwd));
  if (str(ti.path)) return relPath(ti.path, str(cwd));
  if (tool === 'Bash') return str(ti.command);
  if (str(ti.pattern)) return ti.pattern;
  if (str(ti.url)) {
    try { return new URL(ti.url).hostname; } catch { return ''; }
  }
  if (str(ti.query)) return ti.query;
  if (str(ti.description)) return ti.description; // nunca ti.prompt: es texto libre
  return '';
}

// Uso de la memoria: lectura del vault o de Conocimiento, consulta a NotebookLM o subagente investigador.
export function claseMem(input, { vaultPath, conocimientoPath } = {}) {
  if (!input || typeof input !== 'object') return null;
  if (input.hook_event_name === 'SubagentStart') return input.agent_type === 'investigador' ? 'nlm' : null;
  if (input.hook_event_name !== 'PreToolUse') return null;
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  if (input.tool_name === 'Read' && typeof ti.file_path === 'string' && ti.file_path) {
    const f = path.resolve(typeof input.cwd === 'string' && input.cwd ? input.cwd : '.', ti.file_path);
    if (conocimientoPath && dentro(conocimientoPath, f)) return 'conocimiento';
    if (vaultPath && dentro(vaultPath, f)) return 'vault';
  }
  if (input.tool_name === 'Bash' && typeof ti.command === 'string' && /^\s*nlm\s/.test(ti.command) && /\bquery\b/.test(ti.command)) return 'nlm';
  return null;
}

// Nombre del agente sin el espacio de nombres del plugin («project-hq:ejecutor» → «ejecutor»).
export const agentKey = (agent) => String(agent ?? '').replace(/^.*:/, '').trim().toLowerCase();
const ALIAS_RE = /^(opus|sonnet|haiku)$/;
const EFFORT_RE = /^(low|medium|high|xhigh|max)$/;
const alias = (v) => (typeof v === 'string' && ALIAS_RE.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : modelKey(typeof v === 'string' ? v : v?.id ?? v?.display_name));
const effortOf = (v) => {
  const e = typeof v === 'string' ? v : v?.level;
  return typeof e === 'string' && EFFORT_RE.test(e) ? e : null;
};

// Último `Modelo: <alias>/<esfuerzo>` que dejó ese agente en las tarjetas en curso o en verificación.
export function modeloPedido(tasks, agent) {
  const key = agentKey(agent);
  if (!key) return null;
  let mejor = null;
  for (const t of tasks ?? []) {
    if (!['en curso', 'verificando'].includes(String(t.status).toLowerCase())) continue;
    const m = modeloRegistrado(t, key);
    if (m && (!mejor || String(m.created) > String(mejor.created))) mejor = { ...m, card: t.id };
  }
  return mejor;
}

export function summarize(input, { now = new Date(), mainModel = null, vaultPath, conocimientoPath, requestedModel = null } = {}) {
  const kind = KIND[input?.hook_event_name];
  if (!kind) return null;
  const agent = str(input.agent_type) ? clip(input.agent_type, 40) : null;
  const evt = {
    t: now.toISOString(), sid: sid8(input.session_id), kind, tool: null, target: null, agent,
    model: agent ? (AGENT_MODEL[agentKey(agent)] ?? null) : mainModel,
  };
  if (kind === 'subagent_start' || kind === 'subagent_stop') {
    // Prioridad: el modelo del input (si algún día viene), el pedido en la tarjeta (`Modelo:`) y, por último, el mapa.
    const delInput = input.model !== undefined ? alias(input.model) : null;
    const deTarjeta = requestedModel ? alias(requestedModel) : null;
    if (delInput) Object.assign(evt, { model: delInput, model_src: 'input' });
    else if (deTarjeta) Object.assign(evt, { model: deTarjeta, model_src: 'tarjeta' });
    else evt.model_src = 'mapa';
    const effort = effortOf(input.effort);
    if (effort) evt.effort = effort;
  }
  if (kind === 'tool' || kind === 'tool_fail') {
    evt.tool = str(input.tool_name) ? clip(input.tool_name, 40) : null;
    evt.target = clip(targetOf(str(input.tool_name),input.tool_input, input.cwd));
    // Lanzar un subagente: se anota el modelo y el esfuerzo PEDIDOS en la llamada (enums, nunca texto libre).
    const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    if (['Agent', 'Task'].includes(input.tool_name)) {
      if (str(ti.subagent_type)) evt.sub = clip(ti.subagent_type, 40);
      const m = typeof ti.model === 'string' ? alias(ti.model) : null;
      if (m) evt.req_model = m;
      const e = effortOf(ti.effort);
      if (e) evt.req_effort = e;
    }
  }
  if (kind === 'inicio') evt.source = enumOf(input.source);
  if (kind === 'fin') evt.reason = enumOf(input.reason);
  const mem = claseMem(input, { vaultPath, conocimientoPath });
  if (mem) evt.mem = mem;
  if (kind === 'model') evt.model = modelKey(input.model?.display_name ?? input.model?.id ?? input.model) ?? mainModel;
  return evt;
}

export function eventFile(cfg, slug, date) {
  if (!SLUG_RE.test(slug)) throw new Error(`events: slug inválido: ${slug}`);
  return path.join(cfg.eventsDir, slug, `${ymd(date)}.jsonl`);
}

export function appendEvent(cfg, slug, evt, now = new Date(), { maxBytes = 5 * 1024 * 1024 } = {}) {
  const file = eventFile(cfg, slug, now);
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    if (statSync(file).size >= maxBytes) return false;
  } catch {
    // el fichero del día aún no existe
  }
  appendFileSync(file, `${JSON.stringify(evt)}\n`, 'utf8');
  return true;
}

export function pruneEvents(cfg, now = new Date(), days = cfg.eventsRetentionDays ?? 7) {
  if (!existsSync(cfg.eventsDir)) return 0;
  const limite = ymd(new Date(now.getTime() - days * 86400000));
  let borrados = 0;
  for (const name of readdirSync(cfg.eventsDir)) {
    if (name.startsWith('.pruned-')) {
      if (name.slice('.pruned-'.length) < limite) rmSync(path.join(cfg.eventsDir, name), { force: true });
      continue;
    }
    const dir = path.join(cfg.eventsDir, name);
    let files;
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && m[1] < limite) {
        rmSync(path.join(dir, f), { force: true });
        borrados++;
      }
    }
  }
  return borrados;
}

export function maybePrune(cfg, now = new Date(), pruneFn = pruneEvents) {
  const marker = path.join(cfg.eventsDir, `.pruned-${ymd(now)}`);
  if (existsSync(marker)) return 0;
  mkdirSync(cfg.eventsDir, { recursive: true });
  try {
    return pruneFn(cfg, now);
  } finally {
    writeFileSync(marker, '', 'utf8');
  }
}
