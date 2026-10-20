import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT } from '../lib/config.mjs';
import { saveRegistry } from '../lib/registry.mjs';
import { writeSessionState } from '../lib/session-state.mjs';
import { tmpDir, writeConfigFile, writeTask } from './helpers.mjs';

function entorno() {
  const root = tmpDir();
  const { file, cfg } = writeConfigFile(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  saveRegistry(cfg.registryFile, { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] });
  return { root, file, repo, cfg: { ...cfg, eventsDir: path.join(root, 'events'), stateDir: path.join(root, 'state'), logsDir: path.join(root, 'logs') } };
}
const correr = (e, input) => spawnSync(process.execPath, [path.join(HQ_ROOT, 'hooks', 'event.mjs')], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HQ_CONFIG: e.file },
});
const eventos = (e) => {
  const dir = path.join(e.cfg.eventsDir, 'demo');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
};

test('un evento de herramienta dentro del proyecto se guarda con el modelo de la sesión', () => {
  const e = entorno();
  writeSessionState(e.cfg, 'abc12345', { model: 'sonnet' });
  const r = correr(e, { hook_event_name: 'PreToolUse', session_id: 'abc12345-x', cwd: path.join(e.repo, 'src'), tool_name: 'Bash', tool_input: { command: 'npm test' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const [ev] = eventos(e);
  assert.deepEqual([ev.slug, ev.kind, ev.tool, ev.target, ev.model, ev.sid], ['demo', 'tool', 'Bash', 'npm test', 'sonnet', 'abc12345']);
});

test('el texto del prompt no llega al disco', () => {
  const e = entorno();
  correr(e, { hook_event_name: 'UserPromptSubmit', session_id: 's1', cwd: e.repo, prompt: 'clave hunter2' });
  assert.equal(eventos(e)[0].kind, 'prompt');
  assert.doesNotMatch(JSON.stringify(eventos(e)), /hunter2/);
});

test('/clear deja fin (reason clear) en la sid vieja e inicio (source clear) en la nueva', () => {
  const e = entorno();
  assert.equal(correr(e, { hook_event_name: 'SessionEnd', session_id: '565406cf-a', cwd: e.repo, reason: 'clear' }).status, 0);
  assert.equal(correr(e, { hook_event_name: 'SessionStart', session_id: '61f51b10-b', cwd: e.repo, source: 'clear' }).status, 0);
  const evs = eventos(e);
  assert.deepEqual(evs.map((x) => [x.sid, x.kind, x.reason ?? x.source]), [['565406cf', 'fin', 'clear'], ['61f51b10', 'inicio', 'clear']]);
});

test('fuera de un proyecto, con evento desconocido o stdin inválido: silencio y exit 0', () => {
  const e = entorno();
  assert.equal(correr(e, { hook_event_name: 'PreToolUse', cwd: e.root, tool_name: 'Read' }).status, 0);
  assert.equal(correr(e, { hook_event_name: 'Notification', cwd: e.repo }).status, 0);
  const r = correr(e, 'no es json');
  assert.equal(r.status, 0);
  assert.deepEqual(eventos(e), []);
});

test('con el registro dañado sale con 0 y deja el error en el log', () => {
  const e = entorno();
  writeFileSync(e.cfg.registryFile, '{oops');
  const r = correr(e, { hook_event_name: 'PreToolUse', cwd: e.repo, tool_name: 'Read' });
  assert.equal(r.status, 0);
  assert.match(readFileSync(path.join(e.cfg.logsDir, 'hooks.log'), 'utf8'), /event:.*registry/);
});

const metricas = (e) => {
  const dir = path.join(e.root, 'metrics', 'demo');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(path.join(dir, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
};

test('leer una nota del vault o de Conocimiento escribe una línea mem en las métricas', () => {
  const e = entorno();
  const vault = path.join(e.root, 'vault');
  correr(e, { hook_event_name: 'PreToolUse', session_id: 'abc12345-x', cwd: e.repo, tool_name: 'Read', tool_input: { file_path: path.join(vault, 'Conocimiento', 'Temas', 'A.md') } });
  correr(e, { hook_event_name: 'PreToolUse', session_id: 'abc12345-x', cwd: e.repo, tool_name: 'Read', tool_input: { file_path: path.join(vault, 'Proyectos', 'demo', 'Índice.md') } });
  correr(e, { hook_event_name: 'PreToolUse', session_id: 'abc12345-x', cwd: e.repo, tool_name: 'Bash', tool_input: { command: 'nlm notebook query nb "x"' } });
  correr(e, { hook_event_name: 'PreToolUse', session_id: 'abc12345-x', cwd: e.repo, tool_name: 'Read', tool_input: { file_path: path.join(e.repo, 'src', 'a.js') } });
  assert.deepEqual(metricas(e).map((l) => [l.kind, l.mem, l.sid]), [['mem', 'conocimiento', 'abc12345'], ['mem', 'vault', 'abc12345'], ['mem', 'nlm', 'abc12345']]);
  assert.equal(eventos(e).length, 4);
});

test('si las métricas no se pueden escribir el evento se guarda igual y el hook sale con 0', () => {
  const e = entorno();
  writeFileSync(path.join(e.root, 'metrics'), 'fichero en lugar de carpeta');
  const r = correr(e, { hook_event_name: 'PreToolUse', session_id: 'abc12345-x', cwd: e.repo, tool_name: 'Read', tool_input: { file_path: path.join(e.root, 'vault', 'Conocimiento', 'A.md') } });
  assert.equal(r.status, 0);
  assert.equal(eventos(e).length, 1);
});

test('fuera de un proyecto no se escribe nada en las métricas', () => {
  const e = entorno();
  correr(e, { hook_event_name: 'PreToolUse', session_id: 'abc12345-x', cwd: e.root, tool_name: 'Read', tool_input: { file_path: path.join(e.root, 'vault', 'Conocimiento', 'A.md') } });
  assert.deepEqual(metricas(e), []);
});

test('SubagentStop registra el modelo pedido que dejó el agente en la tarjeta activa', () => {
  const e = entorno();
  writeTask(e.repo, 5, { status: 'En curso', labels: ['modelo:sonnet', 'esfuerzo:high'],
    comments: [{ author: '@ejecutor', text: 'Falta: algo' }, { author: '@ejecutor', created: '2026-10-13 10:00', text: 'Modelo: opus/high intento 2' }] });
  assert.equal(correr(e, { hook_event_name: 'SubagentStop', session_id: 's1', cwd: e.repo, agent_type: 'project-hq:ejecutor' }).status, 0);
  assert.equal(correr(e, { hook_event_name: 'SubagentStart', session_id: 's1', cwd: e.repo, agent_type: 'explorador' }).status, 0);
  const [stop, start] = eventos(e);
  assert.deepEqual([stop.kind, stop.model, stop.model_src], ['subagent_stop', 'opus', 'tarjeta']);
  assert.deepEqual([start.model, start.model_src], ['haiku', 'mapa']);
});

test('SubagentStart no usa el Modelo: de la tarjeta (sería el del intento anterior): queda el respaldo del mapa', () => {
  const e = entorno();
  writeTask(e.repo, 6, { status: 'En curso', comments: [{ author: '@ejecutor', text: 'Modelo: sonnet/high intento 1' }, { text: 'Falta: x' }] });
  correr(e, { hook_event_name: 'SubagentStart', session_id: 's1', cwd: e.repo, agent_type: 'project-hq:ejecutor' });
  const [ev] = eventos(e);
  assert.deepEqual([ev.kind, ev.model, ev.model_src], ['subagent_start', 'sonnet', 'mapa']);
});
