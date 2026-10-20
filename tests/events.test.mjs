import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AGENT_MODEL, agentKey, modeloPedido, redact, summarize, eventFile, appendEvent, pruneEvents, maybePrune } from '../lib/events.mjs';
import { makeCfg, tmpDir } from './helpers.mjs';

test('redact oculta claves, variables de entorno y cabeceras de autorización', () => {
  assert.equal(redact('curl -H "Authorization: Bearer abc123" http://x'), 'curl -H "Authorization: …" http://x');
  assert.equal(redact('API_KEY=supersecreto npm test'), 'API_KEY=… npm test');
  assert.equal(redact('token sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 fin'), 'token … fin');
  assert.equal(redact('lib/state.mjs'), 'lib/state.mjs');
});

const base = { session_id: 'abc12345-xyz', cwd: 'C:\\proyectos personales\\demo' };

test('summarize: herramienta con ruta absoluta se vuelve relativa al proyecto', () => {
  const e = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\proyectos personales\\demo\\lib\\state.mjs' } },
    { now: new Date('2026-10-08T15:41:12.000Z'), mainModel: 'sonnet' });
  assert.deepEqual(e, { t: '2026-10-08T15:41:12.000Z', sid: 'abc12345', kind: 'tool', tool: 'Read', target: 'lib\\state.mjs', agent: null, model: 'sonnet' });
});

test('summarize: comando Bash largo se recorta a 80 y se redacta', () => {
  const e = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'TOKEN=abc npm test ' + 'x '.repeat(80) } });
  assert.ok(e.target.length <= 80);
  assert.ok(e.target.startsWith('TOKEN=… npm test'));
});

test('summarize: patrones, URL y subagentes', () => {
  assert.equal(summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: 'chat_id' } }).target, 'chat_id');
  assert.equal(summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://example.com/a/b?q=1' } }).target, 'example.com');
  const s = summarize({ ...base, hook_event_name: 'SubagentStart', agent_type: 'ejecutor' });
  assert.deepEqual([s.kind, s.agent, s.model], ['subagent_start', 'ejecutor', 'sonnet']);
  assert.equal(summarize({ ...base, hook_event_name: 'SubagentStop', agent_type: 'explorador' }).model, 'haiku');
  assert.equal(summarize({ ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'x' } }).kind, 'tool_fail');
  assert.equal(AGENT_MODEL.arquitecto, 'opus');
});

test('summarize: el texto del prompt y las respuestas NUNCA se guardan', () => {
  const p = summarize({ ...base, hook_event_name: 'UserPromptSubmit', prompt: 'mi contraseña es hunter2' });
  assert.equal(p.kind, 'prompt');
  assert.doesNotMatch(JSON.stringify(p), /hunter2/);
  const t = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { prompt: 'secreto: hunter2', description: 'Revisar tarjeta' } });
  assert.doesNotMatch(JSON.stringify(t), /hunter2/);
  assert.equal(t.target, 'Revisar tarjeta');
});

test('summarize: los caracteres de control se sustituyen por espacios (target, tool y agent)', () => {
  const CTRL = /[\u0000-\u001f\u007f-\u009f]/;
  const e = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo \u001b[31mhola\u001b]0;pwned\u0007' } });
  assert.doesNotMatch(e.target, CTRL);
  assert.ok(e.target.startsWith('echo'));
  const t = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Ba\u001bsh', tool_input: { pattern: 'x' } });
  assert.doesNotMatch(t.tool, CTRL);
  const s = summarize({ ...base, hook_event_name: 'SubagentStart', agent_type: 'ejecutor\u001b[0m' });
  assert.doesNotMatch(s.agent, CTRL);
});

test('summarize: modelo cambiado y eventos desconocidos', () => {
  assert.equal(summarize({ ...base, hook_event_name: 'PostModelSwitch', model: { display_name: 'Opus 4.1' } }, { mainModel: 'sonnet' }).model, 'opus');
  assert.equal(summarize({ ...base, hook_event_name: 'Notification' }), null);
  assert.equal(summarize({}), null);
  assert.equal(summarize(undefined), null);
});

test('appendEvent escribe una línea JSON por evento y respeta el tope de tamaño', () => {
  const cfg = makeCfg(tmpDir());
  const now = new Date(2026, 9, 8, 15, 0);
  assert.equal(appendEvent(cfg, 'demo', { kind: 'tool' }, now), true);
  assert.equal(appendEvent(cfg, 'demo', { kind: 'stop' }, now), true);
  const file = eventFile(cfg, 'demo', now);
  assert.match(file, /demo[\\/]2026-10-08\.jsonl$/);
  assert.deepEqual(readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l).kind), ['tool', 'stop']);
  assert.equal(appendEvent(cfg, 'demo', { kind: 'tool' }, now, { maxBytes: 5 }), false);
  assert.throws(() => appendEvent(cfg, '../x', {}, now), /slug inválido/);
});

test('pruneEvents borra solo los días antiguos y maybePrune corre una vez al día', () => {
  const cfg = makeCfg(tmpDir());
  const dir = path.join(cfg.eventsDir, 'demo');
  mkdirSync(dir, { recursive: true });
  for (const d of ['2026-10-01', '2026-10-19', '2026-10-20']) writeFileSync(path.join(dir, `${d}.jsonl`), '{}\n');
  writeFileSync(path.join(dir, 'notas.txt'), 'x');
  const now = new Date(2026, 9, 20, 12, 0);
  assert.equal(pruneEvents(cfg, now, 7), 1);
  assert.deepEqual(readdirSync(dir).sort(), ['2026-10-19.jsonl', '2026-10-20.jsonl', 'notas.txt']);
  writeFileSync(path.join(dir, '2026-10-02.jsonl'), '{}\n');
  assert.equal(maybePrune(cfg, now), 1);
  writeFileSync(path.join(dir, '2026-10-03.jsonl'), '{}\n');
  assert.equal(maybePrune(cfg, now), 0); // ya corrió hoy
  assert.ok(existsSync(path.join(dir, '2026-10-03.jsonl')));
});

test('redact: secretos cortos (flags, URL, cabeceras, asignaciones) no sobreviven', () => {
  const casos = [
    ['mysql -u root -pSECRET123 db', 'SECRET123'], ['mysql --password hunter2 db', 'hunter2'], ['mysql --password=hunter2', 'hunter2'],
    ['curl -u admin:pass123 http://x', 'pass123'], ['git remote add origin https://ghp_abcDEF1234@github.com/a/b', 'ghp_abcDEF1234'],
    ['curl https://user:pass@host/x', 'pass@'], ['psql postgres://u:p4ss@h/db', 'p4ss'], ['x --token abc123def', 'abc123def'],
    ['sshpass -p hunter2 ssh x', 'hunter2'], ['curl -H "X-Api-Key: abc123" x', 'abc123'], ['curl -H "Cookie: sid=abc" x', 'sid=abc'],
    ['aws_secret_access_key=abc', '=abc'], ['api_key=abc123', 'abc123'], ['export password=hunter2', 'hunter2'],
    ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'],
  ];
  for (const [txt, secreto] of casos) assert.ok(!redact(txt).includes(secreto), `${txt} -> ${redact(txt)}`);
  for (const ok of ['npm test', 'mkdir -p src/lib', 'git log -p', 'ls -la', 'node scripts/x.mjs --dry-run', 'lib/state.mjs', 'git commit -m "fix"']) assert.equal(redact(ok), ok);
});

test('summarize: entradas de tipo inesperado no lanzan ni producen [object Object]', () => {
  const pre = (extra) => summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', ...extra });
  const evs = [
    pre({ tool_input: null }), pre({ tool_input: [1] }), pre({ tool_input: 'x' }),
    pre({ tool_input: { file_path: 5 } }), pre({ tool_input: { file_path: {} } }), pre({ tool_input: { command: {} } }),
    summarize({ ...base, hook_event_name: 'SubagentStart', agent_type: {} }),
    summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: {}, tool_input: {} }),
  ];
  for (const e of evs) assert.doesNotMatch(JSON.stringify(e), /object Object/);
  assert.equal(evs[6].agent, null);
  assert.equal(evs[7].tool, null);
});

test('summarize: rutas fuera del proyecto se reducen a los dos últimos segmentos', () => {
  const e = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:\\Users\\ali\\.ssh\\id_rsa' } });
  assert.equal(e.target, '…/.ssh/id_rsa');
});

test('summarize: elimina caracteres bidi y de ancho cero', () => {
  const e = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls \u202eevil\u200bx' } });
  assert.doesNotMatch(e.target, /[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/);
});

test('maybePrune escribe el marcador aunque la poda falle y no reintenta ese día', () => {
  const cfg = makeCfg(tmpDir());
  const now = new Date(2026, 9, 20, 12, 0);
  assert.throws(() => maybePrune(cfg, now, () => { throw new Error('boom'); }), /boom/);
  let llamadas = 0;
  assert.equal(maybePrune(cfg, now, () => { llamadas++; return 5; }), 0);
  assert.equal(llamadas, 0);
});

test('redact: Authorization con cualquier esquema pierde la credencial', () => {
  for (const [txt, secreto] of [['Authorization: ApiKey abc999', 'abc999'], ['Authorization: Digest xyz999', 'xyz999'], ['Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz'], ['Authorization: Bearer abc123', 'abc123'], ['Authorization: abc777', 'abc777']]) {
    assert.ok(!redact(txt).includes(secreto), redact(txt));
  }
});

test('redact: valores entrecomillados con espacios y --user', () => {
  for (const [txt, secreto] of [['x --password "my secret"', 'secret'], ["x --token 'a b c'", 'b c'], ['export TOKEN_X="abc def"', 'def'],
    ['curl --user admin:pass123 x', 'pass123'], ['x --passphrase abc555', 'abc555'], ['https://u:p@ss@h/x', 'ss@']]) {
    assert.ok(!redact(txt).includes(secreto), `${txt} -> ${redact(txt)}`);
  }
  assert.equal(redact('https://u:p@ss@h/x'), 'https://u:…@h/x');
});

test('redact: tiempo lineal con entradas patológicas (< 250 ms cada una)', () => {
  const casos = ['://a:'.repeat(100000), ' -p'.repeat(100000), '--password '.repeat(50000), 'key='.repeat(100000), 'x'.repeat(1e6)];
  for (const c of casos) {
    const t0 = performance.now();
    redact(c);
    const ms = performance.now() - t0;
    assert.ok(ms < 250, `${ms.toFixed(1)} ms`);
    console.log(`# redact perf ${c.slice(0, 12)}... ${ms.toFixed(1)} ms`);
  }
});

test('CONTROL_RUN usa escapes \\u, no caracteres invisibles literales', () => {
  const src = readFileSync(new URL('../lib/events.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /[​-‏‪-‮⁦-⁩]/);
});

test('claseMem: Read en conocimiento/vault, nlm query y subagente investigador; lo demás no cuenta', async () => {
  const { claseMem } = await import('../lib/events.mjs');
  const rutas = { vaultPath: 'C:/Bovedas/ProjectHQ', conocimientoPath: 'C:/Bovedas/ProjectHQ/Conocimiento' };
  const pre = (tool_name, tool_input, extra = {}) => ({ hook_event_name: 'PreToolUse', tool_name, tool_input, ...extra });
  assert.equal(claseMem(pre('Read', { file_path: 'C:/Bovedas/ProjectHQ/Conocimiento/Temas/X.md' }), rutas), 'conocimiento');
  assert.equal(claseMem(pre('Read', { file_path: 'c:/bovedas/projecthq/conocimiento/index.md' }), rutas), process.platform === 'win32' ? 'conocimiento' : null);
  assert.equal(claseMem(pre('Read', { file_path: 'C:/Bovedas/ProjectHQ/Proyectos/demo/Índice.md' }), rutas), 'vault');
  assert.equal(claseMem(pre('Read', { file_path: 'C:/Bovedas/ProjectHQ2/x.md' }), rutas), null);
  assert.equal(claseMem(pre('Read', { file_path: 'C:/repo/src/a.js' }), rutas), null);
  assert.equal(claseMem(pre('Edit', { file_path: 'C:/Bovedas/ProjectHQ/Conocimiento/X.md' }), rutas), null);
  assert.equal(claseMem(pre('Bash', { command: 'nlm notebook query abc "pregunta"' }), rutas), 'nlm');
  assert.equal(claseMem(pre('Bash', { command: '  nlm query abc x | head' }), rutas), 'nlm');
  assert.equal(claseMem(pre('Bash', { command: 'nlm login --profile hq' }), rutas), null);
  assert.equal(claseMem(pre('Bash', { command: 'echo nlm query' }), rutas), null);
  assert.equal(claseMem({ hook_event_name: 'SubagentStart', agent_type: 'investigador' }, rutas), 'nlm');
  assert.equal(claseMem({ hook_event_name: 'SubagentStart', agent_type: 'explorador' }, rutas), null);
  assert.equal(claseMem(pre('Read', { file_path: 'C:/Bovedas/ProjectHQ/Conocimiento/X.md' }), {}), null);
  assert.equal(claseMem(pre('Read', {}), rutas), null);
  assert.equal(claseMem(null, rutas), null);
  assert.equal(claseMem(pre('Read', { file_path: 42 }), rutas), null);
});

test('summarize añade mem solo cuando hay uso de la memoria', () => {
  const rutas = { vaultPath: 'C:/Bovedas/ProjectHQ', conocimientoPath: 'C:/Bovedas/ProjectHQ/Conocimiento' };
  const input = { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Read', tool_input: { file_path: 'C:/Bovedas/ProjectHQ/Conocimiento/a.md' }, cwd: 'C:/x' };
  assert.equal(summarize(input, rutas).mem, 'conocimiento');
  assert.equal(summarize(input, {}).mem, undefined);
  assert.equal(summarize({ ...input, tool_input: { file_path: 'C:/x/a.js' } }, rutas).mem, undefined);
});

test('summarize: el agente con espacio de nombres del plugin usa el mapa sin el prefijo', () => {
  const s = summarize({ ...base, hook_event_name: 'SubagentStart', agent_type: 'project-hq:ejecutor' });
  assert.deepEqual([s.agent, s.model, s.model_src], ['project-hq:ejecutor', 'sonnet', 'mapa']);
  assert.equal(agentKey('project-hq:revisor'), 'revisor');
});

test('summarize: SubagentStart/Stop prefieren el modelo del input, luego el pedido en la tarjeta y luego el mapa', () => {
  const desdeInput = summarize({ ...base, hook_event_name: 'SubagentStop', agent_type: 'ejecutor', model: 'claude-opus-5-5', effort: { level: 'xhigh' } }, { requestedModel: 'sonnet' });
  assert.deepEqual([desdeInput.model, desdeInput.model_src, desdeInput.effort], ['opus', 'input', 'xhigh']);
  const desdeTarjeta = summarize({ ...base, hook_event_name: 'SubagentStart', agent_type: 'project-hq:ejecutor' }, { requestedModel: 'opus' });
  assert.deepEqual([desdeTarjeta.model, desdeTarjeta.model_src], ['opus', 'tarjeta']);
  const raro = summarize({ ...base, hook_event_name: 'SubagentStop', agent_type: 'revisor', effort: { level: 'rm -rf' } });
  assert.deepEqual([raro.model, raro.model_src, raro.effort], ['sonnet', 'mapa', undefined]);
});

test('summarize: lanzar un subagente anota el modelo y el esfuerzo pedidos, nunca el prompt', () => {
  const e = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Agent',
    tool_input: { subagent_type: 'project-hq:ejecutor', model: 'opus', effort: 'xhigh', prompt: 'secreto hunter2', description: 'Ejecutar TASK-3' } }, { mainModel: 'sonnet' });
  assert.deepEqual([e.sub, e.req_model, e.req_effort, e.model, e.target], ['project-hq:ejecutor', 'opus', 'xhigh', 'sonnet', 'Ejecutar TASK-3']);
  assert.doesNotMatch(JSON.stringify(e), /hunter2/);
  const sin = summarize({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { subagent_type: 'revisor', model: 'cualquier cosa', effort: 'mucho' } });
  assert.deepEqual([sin.req_model, sin.req_effort], [undefined, undefined]);
});

test('summarize: SessionStart es inicio con su source y SessionEnd es fin con su reason', () => {
  const now = new Date('2026-10-13T16:34:21.000Z');
  const i = summarize({ ...base, hook_event_name: 'SessionStart', source: 'clear' }, { now, mainModel: 'opus' });
  assert.deepEqual(i, { t: '2026-10-13T16:34:21.000Z', sid: 'abc12345', kind: 'inicio', tool: null, target: null, agent: null, model: 'opus', source: 'clear' });
  const f = summarize({ ...base, hook_event_name: 'SessionEnd', reason: 'prompt_input_exit' }, { now });
  assert.deepEqual([f.kind, f.reason, f.source], ['fin', 'prompt_input_exit', undefined]);
  for (const source of ['startup', 'resume', 'compact']) {
    assert.equal(summarize({ ...base, hook_event_name: 'SessionStart', source }).source, source);
  }
  assert.equal(summarize({ ...base, hook_event_name: 'SessionEnd', reason: 'clear' }).reason, 'clear');
});

test('summarize: source/reason solo en inicio/fin y solo como identificador (nunca texto libre)', () => {
  const raro = summarize({ ...base, hook_event_name: 'SessionStart', source: 'clear\u001b]0;pwned\u0007' });
  assert.equal(raro.kind, 'inicio');
  assert.equal(raro.source, null);
  assert.equal(summarize({ ...base, hook_event_name: 'SessionStart', source: 'x'.repeat(41) }).source, null);
  assert.equal(summarize({ ...base, hook_event_name: 'SessionStart' }).source, null);
  assert.equal(summarize({ ...base, hook_event_name: 'SessionEnd', reason: { a: 1 } }).reason, null);
  assert.equal(summarize({ ...base, hook_event_name: 'SessionEnd', reason: 'rm -rf /' }).reason, null);
  const otro = summarize({ ...base, hook_event_name: 'Stop', source: 'clear', reason: 'clear' });
  assert.deepEqual([otro.kind, otro.source, otro.reason], ['stop', undefined, undefined]);
});

test('modeloPedido: último Modelo: del agente en tarjetas en curso o en verificación', () => {
  const t = (id, status, comments) => ({ id, status, comments });
  const tasks = [
    t('TASK-1', 'Hecho', [{ author: '@ejecutor', created: '2026-10-13 09:00', text: 'Modelo: opus/xhigh intento 3' }]),
    t('TASK-2', 'En curso', [{ author: '@ejecutor', created: '2026-10-12 10:00', text: 'Modelo: sonnet/high intento 1' },
      { author: '@ejecutor', created: '2026-10-12 11:00', text: 'Modelo: opus/high intento 2' }]),
    t('TASK-3', 'Verificando', [{ author: '@revisor', created: '2026-10-12 12:00', text: 'Modelo: opus/high intento 1' }]),
  ];
  assert.deepEqual(modeloPedido(tasks, 'project-hq:ejecutor'), { model: 'opus', effort: 'high', created: '2026-10-12 11:00', card: 'TASK-2' });
  assert.equal(modeloPedido(tasks, 'revisor').card, 'TASK-3');
  assert.equal(modeloPedido(tasks, 'explorador'), null);
  assert.equal(modeloPedido([], 'ejecutor'), null);
});
