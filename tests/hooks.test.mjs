import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HQ_ROOT } from '../lib/config.mjs';
import { saveRegistry } from '../lib/registry.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

function env() {
  const root = tmpDir();
  const { file, cfg } = writeConfigFile(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  saveRegistry(cfg.registryFile, { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] });
  return { root, file, cfg, repo };
}
function runHook(name, e, input) {
  return spawnSync(process.execPath, [path.join(HQ_ROOT, 'hooks', name)], {
    input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HQ_CONFIG: e.file },
  });
}

test('SessionStart dentro de una subcarpeta del proyecto inyecta contexto', () => {
  const e = env();
  const r = runHook('session-start.mjs', e, { cwd: path.join(e.repo, 'src'), hook_event_name: 'SessionStart' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /\[Project HQ\] Demo/);
});

test('SessionStart fuera de un proyecto no imprime nada y sale con 0', () => {
  const e = env();
  const r = runHook('session-start.mjs', e, { cwd: e.root });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('SessionStart con registry dañado: exit 0, sin salida y error en el log', () => {
  const e = env();
  writeFileSync(e.cfg.registryFile, '{oops');
  const r = runHook('session-start.mjs', e, { cwd: e.repo });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(readFileSync(path.join(e.cfg.logsDir, 'hooks.log'), 'utf8'), /registry/);
});

test('SessionStart con stdin vacío o inválido no rompe', () => {
  const e = env();
  const r = spawnSync(process.execPath, [path.join(HQ_ROOT, 'hooks', 'session-start.mjs')], {
    input: 'esto no es json', encoding: 'utf8', env: { ...process.env, HQ_CONFIG: e.file },
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('hooks.json declara SessionStart, PreCompact y Stop apuntando a ficheros que existen', () => {
  const hooks = JSON.parse(readFileSync(path.join(HQ_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const ev of ['SessionStart', 'PreCompact', 'Stop']) {
    const cmd = hooks[ev][0].hooks[0].command;
    const file = cmd.match(/hooks\/([\w-]+\.mjs)/)[1];
    assert.ok(existsSync(path.join(HQ_ROOT, 'hooks', file)), `${ev} -> ${file}`);
  }
});

test('Stop dentro de un proyecto escribe una nota de sesión y sale con 0; fuera no escribe', () => {
  const e = env();
  const r = runHook('stop.mjs', e, { cwd: e.repo, session_id: `${Math.random().toString(36).slice(2, 10)}${Date.now()}` });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const dir = path.join(e.cfg.vaultPath, 'Proyectos', 'demo', 'Sesiones');
  assert.ok(existsSync(dir));
  const r2 = runHook('stop.mjs', e, { cwd: e.root, session_id: `${Math.random().toString(36).slice(2, 10)}${Date.now()}x` });
  assert.equal(r2.status, 0);
});

test('los hooks terminan con process.exitCode (sin process.exit que corte stdout pendiente)', () => {
  for (const f of ['session-start.mjs', 'stop.mjs', 'pre-compact.mjs']) {
    const src = readFileSync(path.join(HQ_ROOT, 'hooks', f), 'utf8');
    assert.ok(!/process\.exit\(/.test(src), f);
    assert.ok(/process\.exitCode = 0/.test(src), f);
  }
});

test('hooks.json registra event.mjs como hook asíncrono en los eventos de actividad', () => {
  const hooks = JSON.parse(readFileSync(path.join(HQ_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const ev of ['PreToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop', 'PostModelSwitch', 'UserPromptSubmit', 'Stop', 'SessionStart', 'SessionEnd']) {
    const h = hooks[ev].flatMap((b) => b.hooks).find((x) => x.command.includes('hooks/event.mjs'));
    assert.ok(h, ev);
    assert.equal(h.async, true, ev);
  }
  assert.match(hooks.Stop[0].hooks[0].command, /stop\.mjs/); // el hook de Stop original sigue primero
  assert.ok(existsSync(path.join(HQ_ROOT, 'hooks', 'event.mjs')));
});

test('hooks.json: SessionStart sigue inyectando contexto (síncrono, primero) y event.mjs async registra inicio y fin', () => {
  const hooks = JSON.parse(readFileSync(path.join(HQ_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const inicio = hooks.SessionStart.flatMap((b) => b.hooks);
  assert.match(inicio[0].command, /session-start\.mjs/);
  assert.notEqual(inicio[0].async, true);
  // El matcher de SessionStart cubre los cuatro orígenes: estado_claude necesita sobre todo «clear».
  const bloque = hooks.SessionStart.find((b) => b.hooks.some((h) => h.command.includes('hooks/event.mjs')));
  for (const src of ['startup', 'resume', 'clear', 'compact']) assert.ok(!bloque.matcher || bloque.matcher.split('|').includes(src), src);
  const fin = hooks.SessionEnd.find((b) => b.hooks.some((h) => h.command.includes('hooks/event.mjs')));
  assert.ok(fin && !fin.matcher, 'SessionEnd sin matcher: todos los reason (clear, salida, logout...)');
});

test('hooks.json registra gate.mjs como hook SÍNCRONO de PreToolUse para shells y escrituras', () => {
  const hooks = JSON.parse(readFileSync(path.join(HQ_ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  const bloque = hooks.PreToolUse.find((b) => b.hooks.some((h) => h.command.includes('hooks/gate.mjs')));
  assert.ok(bloque, 'falta el bloque de gate.mjs');
  assert.match(bloque.matcher, /Bash/);
  assert.match(bloque.matcher, /PowerShell/);
  assert.match(bloque.matcher, /Write/);
  assert.match(bloque.matcher, /Edit/);
  assert.notEqual(bloque.hooks.find((h) => h.command.includes('gate.mjs')).async, true);
  assert.ok(existsSync(path.join(HQ_ROOT, 'hooks', 'gate.mjs')));
});

test('SessionStart registra los caracteres de contexto inyectados en las métricas', () => {
  const e = env();
  const r = runHook('session-start.mjs', e, { cwd: path.join(e.repo, 'src'), session_id: 'abc12345-x' });
  const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  const f = path.join(e.root, 'metrics', 'demo');
  const lineas = readFileSync(path.join(f, readdirSync(f)[0]), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual([lineas[0].kind, lineas[0].sid, lineas[0].chars], ['inicio', 'abc12345', ctx.length]);
});

test('SessionStart fuera de proyecto no escribe métricas y con métricas imposibles sigue inyectando', () => {
  const e = env();
  runHook('session-start.mjs', e, { cwd: e.root, session_id: 'x' });
  assert.equal(existsSync(path.join(e.root, 'metrics')), false);
  writeFileSync(path.join(e.root, 'metrics'), 'fichero');
  const r = runHook('session-start.mjs', e, { cwd: e.repo, session_id: 'abc12345-x' });
  assert.equal(r.status, 0);
  assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /\[Project HQ\]/);
});
