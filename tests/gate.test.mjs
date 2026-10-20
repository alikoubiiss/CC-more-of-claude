import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { RAZON, checkCommand, checkToolCall, mencionaProyecto, textoDeLaLlamada } from '../lib/gate.mjs';
import { HQ_ROOT } from '../lib/config.mjs';
import { saveRegistry } from '../lib/registry.mjs';
import { tmpDir, writeConfigFile } from './helpers.mjs';

const BLOQUEADOS = [
  'backlog task edit 3 -s "Hecho"',
  'backlog task edit 3 --status Hecho',
  "backlog task edit 3 -s='Hecho' --plain",
  'cd x && backlog task edit 3 -s hecho --plain',
  'backlog task create "x" -s Done',
  'node "C:/proyectos personales/project-hq/scripts/fases.mjs" approve f1',
  "node -e \"import('./lib/fases.mjs').then(m=>m.approvePhase('.', 'f1','2026-10-09'))\"",
  "echo '{}' > .hq/fases.json",
  'sed -i s/null/2026/ .hq/fases.json',
  'rm .hq\\fases.json',
  "sed -i 's/En curso/Hecho/' backlog/tasks/task-3*.md",
  'backlog task edit 3 --status=HECHO',
  "backlog task edit 3 -s 'Hecho'",
  'backlog task edit 3 -s "hecho "',
  'backlog task edit 3 --plain -s Hecho',
  'backlog.cmd task edit 3 -s Hecho',
  'npx backlog.md task edit 3 -s Hecho',
  'npx -y backlog.md task edit 3 -s Hecho',
  'bash -c "backlog task edit 3 -s Hecho"',
  'cd x && backlog task edit 3 -s Hecho',
  'ls\nbacklog task edit 3 -s Hecho',
  'backlog task edit 3 -sHecho',
  'backlog task edit 3 -t "Fix A & B" -s Hecho',
  'backlog task edit 3 -t "a;b" -s Hecho',
  'backlog task edit 3 -d "x | y" --status Done',
  'echo ' + 'a'.repeat(6000) + '; backlog task edit 3 -s Hecho',
  'FOO=1 backlog task edit 3 -s Hecho',
  'node scripts/fases.mjs  approve f1',
  'node "C:/x/scripts/fases.mjs" approve f1',
  'node ./fases.mjs approve',
  'echo x > .hq/fases.json',
  'echo x >>.hq/fases.json',
  'cat a | tee .hq/fases.json',
  'cp /tmp/x .hq/fases.json',
  'mv /tmp/x .hq\\fases.json',
  'rm .hq/fases.json',
  "Set-Content .hq\\fases.json 'x'",
  "python -c \"open('.hq/fases.json','w').write('{}')\"",
  "node -e \"require('fs').writeFileSync('.hq/fases.json','{}')\"",
  "sed -i 's/En curso/Hecho/' backlog/tasks/task-3.md",
  "echo 'status: Hecho' > backlog/tasks/task-3.md",
];
const PERMITIDOS = [
  'backlog task edit 3 -s "En curso"',
  'backlog task edit 3 -s "Verificando" --add-label revisada',
  'backlog task list -s "Hecho" --plain',
  'backlog task 3 --plain',
  'node scripts/fases.mjs status',
  'node scripts/fases.mjs set',
  'node scripts/fases.mjs set <<\'EOF\'\n{"fases":["Diseño"]}\nEOF',
  'cat .hq/fases.json',
  'cat .hq/fases.json 2>&1',
  'cat .hq/fases.json > /tmp/out.txt',
  'cp .hq/fases.json /tmp/bak.json',
  'cat .hq/fases.json | tee /tmp/x',
  'grep Hecho backlog/tasks/*.md',
  'npm test',
  'git commit -m "marca Hecho"',
  'git commit -m "tarjeta Hecho"',
  'git commit -m "doc: node fases.mjs approve f1"',
  'git commit -m "fix approvePhase"',
  'grep -rn approvePhase lib/',
  'echo "hay que usar backlog task edit 3 -s Hecho"',
  "echo 'backlog task edit 3 -s Hecho'",
  'node scripts/vault-cli.mjs session <<\'EOF\'\n{"summary":"ejecuté backlog task edit 3 -s Hecho y falló"}\nEOF',
  'backlog task edit 3 -s "En curso" && echo Hecho > x.txt',
  'git mv docs/fases.json.md docs/x.md',
  'echo "see fases.json" > notes.txt',
];

const B = 'backlog task edit 3 -s Hecho';
const A = 'node scripts/fases.mjs approve f1';
const envolturas = (X) => [
  `(${X})`, `$(${X})`, `timeout 5 ${X}`, `( ${X} )`, `((${X}))`, `{ ${X}; }`, `{ ${X};}`, `! ${X}`,
  `true && (${X})`, `echo x; ( ${X} ) | cat`, `\`${X}\``, `echo $(${X})`, `echo "$(${X})"`, `x=$(${X})`,
  `(cd x && ${X})`, `if true; then ${X}; fi`, `for i in 1; do ${X}; done`, `while true; do ${X}; done`,
  `command ${X}`, `exec ${X}`, `builtin ${X}`, `nice ${X}`, `nice -n 5 ${X}`, `timeout -s KILL 5 ${X}`,
  `xargs ${X}`, `stdbuf -oL ${X}`, `ionice -c 3 ${X}`, `doas ${X}`, `watch -n 5 ${X}`, `call ${X}`,
  `start ${X}`, `start "t" /b ${X}`, `cmd /c start ${X}`, `sudo -u x ${X}`, `sudo -E ${X}`,
  `env -S "${X}"`, `env -u FOO ${X}`, `eval "${X}"`, `bash -c "(${X})"`, `powershell -Command "& { ${X} }"`,
  `sh <<EOF\n${X}\nEOF`, `echo "a $(echo "b $(${X})")"`, `bash -c '$(${X})'`,
];
const BLOQUEADOS_R2 = [
  ...envolturas(B),
  ...['(X)', '$(X)', 'timeout 5 X', '`X`', 'sudo -u x X', 'env -S "X"'].map((t) => t.replace('X', A)),
  'echo x>.hq/fases.json', 'echo x>>.hq/fases.json', 'echo x>.hq\\fases.json', 'cat a|tee .hq/fases.json',
  'echo x 1>.hq/fases.json', 'echo x &>.hq/fases.json',
  "echo it\\'s; " + B, 'echo \\"; ' + B, 'echo a \\\n; ' + B, 'echo a\\\nb; ' + B,
  '(backlog task edit 3 -s Hecho)', '{ backlog task edit 3 -s Hecho}',
];
const PERMITIDOS_R2 = [
  `echo '$(${B})'`, `echo "(${B})"`, `echo ${B}`, 'echo "$(date)"', 'timeout 5 ls', 'nice -n 5 npm test',
  'sudo -u x ls', 'xargs echo', 'echo x>notes.txt', 'cat .hq/fases.json>/tmp/out.txt',
  'cp .hq/fases.json /tmp/bak.json', `cat <<'EOF'\n${B}\nEOF`,
  `git commit -m "$(cat <<'EOF'\n${B}\nEOF\n)"`, `bash <<'EOF'\nls\nEOF`, `cat <<EOF | sh\nls\nEOF`,
  `echo "a $(echo b)"`, `echo '${B}'`, 'start "t" /b ls', 'env -S "ls -l"', 'eval "ls"', 'echo x 2>&1',
  'ls "C:\\proyectos personales\\demo"', 'echo it\\\'s; ls', '(cd x && ls)', 'if true; then ls; fi',
  'env -u FOO ls', 'echo x>/dev/null', 'echo a && echo b >&2',
];

const dq = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const BLOQUEADOS_R3 = [
  // 1. profundidad agotada
  `$($($($(${B}))))`, `$($($($($(${B})))))`,
  `bash -c ${dq(`bash -c ${dq(`bash -c ${dq(`bash -c '${B}'`)}`)}`)}`,
  `eval ${dq(`eval ${dq(`eval ${dq(`eval ${B}`)}`)}`)}`, `echo $(echo $(echo $(echo $(${B}))))`,
  // 2. pipe a shell y here-strings
  `echo "${B}" | bash`, `echo ${B} | sh`, `printf '${B}' | bash -s`, `echo ${B}|bash`, `echo ${B} | zsh`,
  `echo ${B} | /bin/bash`, `cat <<EOF | bash\n${B}\nEOF`, `cat <<EOF | sh -s\n${B}\nEOF`,
  `bash <<< "${B}"`, `sh <<< ${B}`, `bash <<<"${B}"`, `printf '${B}\\n' | sh`,
  // 3. heredoc con flags
  `bash -x <<EOF\n${B}\nEOF`, `bash --login <<EOF\n${B}\nEOF`, `bash 3<<EOF\n${B}\nEOF`, `<<EOF bash\n${B}\nEOF`,
  // 4. -c combinado
  `bash -lc "${B}"`, `bash.exe -lc "${B}"`, `bash -ec "${B}"`, `"C:\\Program Files\\Git\\bin\\bash.exe" -lc "${B}"`,
  // 5. runners y envolturas
  `pnpm exec ${B}`, `yarn ${B}`, 'bunx backlog.md task edit 3 -s Hecho', `bun x ${B}`, `time -p ${B}`,
  `setsid ${B}`, `flock lock ${B}`, `chronic ${B}`, `parallel ${B}`, `strace -o out ${B}`, `busybox ${B}`,
  `wsl ${B}`, `wsl.exe -e ${B}`, `ssh host ${B}`, `ssh -p 22 host "cd x && ${B}"`, `su -c "${B}"`,
  `script -c "${B}" out.log`, `cmd /k ${B}`, `find . -exec ${B} \\;`,
  // 6. >|
  'echo x >| .hq/fases.json',
  // 7. comentarios
  `echo hi # it's\n${B}`, `echo # '\n${B}`, `echo hi # "\n${B}`,
];
const PERMITIDOS_R3 = [
  '$(echo $(echo $(echo $(echo $(date)))))', `echo ${B} | cat`, `echo ${B} | grep x`, `echo ${B} | tee log`,
  `cat <<EOF | cat\n${B}\nEOF`, 'pnpm exec jest', 'yarn test', 'ssh host ls', 'wsl ls', 'echo x >| notes.txt',
  'echo a#b', 'echo https://x/y#frag', 'git commit -m "a # b"', 'echo hi # comentario\nls', 'bash script.sh',
  'echo ls | bash', 'printf "ls\\n" | sh', 'bash <<< "ls"', 'bash -lc "ls"', 'find . -name x -exec ls {} \\;',
  'su -c "ls"', 'time -p ls', 'bash -x <<EOF\nls\nEOF',
];

test('round 3: profundidad, pipes a shell, here-strings, -c combinado, runners, >| y comentarios', () => {
  for (const c of BLOQUEADOS_R3) assert.equal(checkCommand(c), RAZON, c.slice(0, 120));
  for (const c of PERMITIDOS_R3) assert.equal(checkCommand(c), null, c.slice(0, 120));
});

test('round 2: envolturas, subshells, sustituciones, redirecciones pegadas y escapes se deniegan', () => {
  for (const c of BLOQUEADOS_R2) assert.equal(checkCommand(c), RAZON, c.slice(0, 120));
});

test('round 2: texto entrecomillado, datos de heredoc y comandos normales siguen permitidos', () => {
  for (const c of PERMITIDOS_R2) assert.equal(checkCommand(c), null, c.slice(0, 120));
});

test('round 2: rutas de Windows con barra invertida', () => {
  assert.equal(checkCommand('rm .hq\\fases.json'), RAZON);
  assert.equal(checkCommand('ls "C:\\proyectos personales\\demo"'), null);
  assert.equal(checkCommand('cat C:\\proyectos personales\\x'), null);
});

test('round 2: lineal y sin lanzar con construcciones nuevas', () => {
  const trozos = ['(', '$(', '`', '{', '<<EOF\n', '"', "'", '\\', '((((', '$((', 'bash <<EOF\n', '! ', 'timeout ', 'env -S "', 'x>', '# ', '#\n', 'echo a | bash\n', '>| ', 'echo hi | sh -s\n', 'echo backlog | bash\n','cat <<EOF | bash\n', 'ssh h ', 'bash <<< ', 'find -exec '];
  for (const t of trozos) {
    const c = t.repeat(Math.ceil(1e6 / t.length));
    const t0 = Date.now();
    const r = checkCommand(c);
    assert.ok(r === null || r === RAZON);
    assert.ok(Date.now() - t0 < 1500, `${JSON.stringify(t)} tardó ${Date.now() - t0} ms`);
  }
});

test('checkCommand bloquea cerrar tarjetas, aprobar fases y escribir en fases.json', () => {
  for (const c of BLOQUEADOS) assert.equal(checkCommand(c), RAZON, c.slice(0, 120));
});

test('checkCommand deja pasar lecturas, menciones y cambios de estado normales', () => {
  for (const c of PERMITIDOS) assert.equal(checkCommand(c), null, c);
  for (const v of [undefined, null, 42, { a: 1 }, ['x']]) assert.equal(checkCommand(v), null);
});

test('checkCommand es lineal con entradas patológicas', () => {
  const entradas = ['x'.repeat(1e6), 'backlog task '.repeat(1e5), 'backlog task edit '.repeat(5e4), '-s '.repeat(1e5),
    "'".repeat(1e6), '<<EOF\n'.repeat(1e5), 'a && '.repeat(2e5), '"'.repeat(1e6)];
  for (const c of entradas) {
    const t0 = Date.now();
    checkCommand(c);
    assert.ok(Date.now() - t0 < 1500, `tardó ${Date.now() - t0} ms`);
  }
});

test('checkToolCall: Bash/PowerShell por el comando; Write/Edit sobre fases.json; lo demás pasa', () => {
  assert.equal(checkToolCall({ tool_name: 'Bash', tool_input: { command: 'backlog task edit 3 -s Hecho' } }), RAZON);
  assert.equal(checkToolCall({ tool_name: 'PowerShell', tool_input: { command: 'backlog task edit 3 -s Hecho' } }), RAZON);
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    assert.equal(checkToolCall({ tool_name: tool, tool_input: { file_path: 'C:\\p\\demo\\.hq\\fases.json' } }), RAZON, tool);
    assert.equal(checkToolCall({ tool_name: tool, tool_input: { file_path: 'C:/p/demo/.hq/fases.json' } }), RAZON, tool);
    assert.equal(checkToolCall({ tool_name: tool, tool_input: { file_path: 'C:\\p\\demo\\docs\\x.md' } }), null, tool);
    assert.equal(checkToolCall({ tool_name: tool, tool_input: { file_path: 'C:\\p\\demo\\docs\\fases.json.md' } }), null, tool);
    assert.equal(checkToolCall({ tool_name: tool, tool_input: { file_path: 'C:\\p\\demo\\.hq\\fases.json.bak' } }), null, tool);
  }
  assert.equal(checkToolCall({ tool_name: 'Read', tool_input: { file_path: '.hq/fases.json' } }), null);
  assert.equal(checkToolCall({ tool_name: 'Bash', tool_input: null }), null);
  assert.equal(checkToolCall({ tool_name: 'Bash', tool_input: { command: 42 } }), null);
  for (const v of [undefined, null, 7, 'x', []]) assert.equal(checkToolCall(v), null);
});

test('textoDeLaLlamada devuelve el comando o la ruta', () => {
  assert.equal(textoDeLaLlamada({ tool_name: 'Bash', tool_input: { command: 'ls' } }), 'ls');
  assert.equal(textoDeLaLlamada({ tool_name: 'PowerShell', tool_input: { command: 'dir' } }), 'dir');
  assert.equal(textoDeLaLlamada({ tool_name: 'Write', tool_input: { file_path: 'a/b' } }), 'a/b');
  assert.equal(textoDeLaLlamada({ tool_name: 'MultiEdit', tool_input: { file_path: 'a/c' } }), 'a/c');
  assert.equal(textoDeLaLlamada({ tool_name: 'Read', tool_input: { file_path: 'a' } }), '');
  assert.equal(textoDeLaLlamada({ tool_name: 'Bash', tool_input: { command: 3 } }), '');
  assert.equal(textoDeLaLlamada(undefined), '');
});

test('mencionaProyecto normaliza mayúsculas, barras y barra final, sin falsos positivos por prefijo', () => {
  assert.equal(mencionaProyecto('cd "C:\\Proy\\Demo" && ls', ['c:/proy/demo/']), true);
  assert.equal(mencionaProyecto('rm C:/PROY/DEMO/.hq/fases.json', ['C:\\proy\\demo']), true);
  assert.equal(mencionaProyecto('cd C:/proy/demo-2 && ls', ['C:/proy/demo']), false);
  assert.equal(mencionaProyecto('cd C:/proy/demo-2 && cd C:/proy/demo', ['C:/proy/demo']), true);
  assert.equal(mencionaProyecto('ls', ['C:/proy/demo']), false);
  assert.equal(mencionaProyecto('ls', []), false);
  assert.equal(mencionaProyecto('', ['C:/proy/demo']), false);
});

function entorno() {
  const root = tmpDir();
  const { file, cfg } = writeConfigFile(root);
  const repo = path.join(root, 'mis proyectos', 'demo');
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  saveRegistry(cfg.registryFile, { projects: [{ slug: 'demo', display: 'Demo', path: repo, port: 6430 }] });
  return { root, file, repo, cfg: { ...cfg, logsDir: path.join(root, 'logs') } };
}
const correr = (e, input) => spawnSync(process.execPath, [path.join(HQ_ROOT, 'hooks', 'gate.mjs')], {
  input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, HQ_CONFIG: e.file },
});

test('el hook deniega con el formato oficial dentro de un proyecto HQ', () => {
  const e = entorno();
  const r = correr(e, { hook_event_name: 'PreToolUse', cwd: path.join(e.repo, 'src'), tool_name: 'Bash', tool_input: { command: 'backlog task edit 3 -s "Hecho"' } });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /cc/);
});

test('fuera de un proyecto, con comandos normales o con stdin inválido deja pasar en silencio', () => {
  const e = entorno();
  assert.equal(correr(e, { cwd: e.root, tool_name: 'Bash', tool_input: { command: 'backlog task edit 3 -s "Hecho"' } }).stdout, '');
  assert.equal(correr(e, { cwd: e.repo, tool_name: 'Bash', tool_input: { command: 'npm test' } }).stdout, '');
  const r = correr(e, 'no es json');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('cwd fuera del proyecto pero el comando nombra la ruta del proyecto: deniega', () => {
  const e = entorno();
  const r = correr(e, { cwd: e.root, tool_name: 'Bash', tool_input: { command: `cd "${e.repo}" && backlog task edit 3 -s Hecho` } });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('Write sobre <proyecto>/.hq/fases.json con cwd fuera del proyecto: deniega', () => {
  const e = entorno();
  const r = correr(e, { cwd: e.root, tool_name: 'Write', tool_input: { file_path: path.join(e.repo, '.hq', 'fases.json'), content: '{}' } });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.permissionDecision, 'deny');
});

test('si el registro está dañado, deja pasar (abierto ante errores), sale con 0 y lo registra', () => {
  const e = entorno();
  writeFileSync(e.cfg.registryFile, '{oops');
  const r = correr(e, { cwd: e.repo, tool_name: 'Bash', tool_input: { command: 'backlog task edit 3 -s Hecho' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.match(readFileSync(path.join(e.cfg.logsDir, 'hooks.log'), 'utf8'), /gate:.*registry/);
});

test('R3 Write/Edit/MultiEdit no pueden dejar una tarjeta de Backlog.md en Hecho', () => {
  const tarea = 'C:/proyectos personales/demo/backlog/tasks/task-9 - algo.md';
  const w = (tool_name, tool_input) => checkToolCall({ tool_name, tool_input });
  for (const estado of ['Hecho', 'hecho', '"Hecho"', "'Done'", 'DONE']) {
    assert.equal(w('Write', { file_path: tarea, content: `---\nid: TASK-9\nstatus: ${estado}\n---\n` }), RAZON, estado);
    assert.equal(w('Edit', { file_path: tarea, old_string: 'status: En curso', new_string: `status: ${estado}` }), RAZON, estado);
  }
  assert.equal(w('MultiEdit', { file_path: tarea, edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'status: Verificando', new_string: 'status: Hecho' }] }), RAZON);
  const conBarrasInvertidas = ['C:', 'proyectos personales', 'demo', 'backlog', 'tasks', 'task-9 - algo.md'].join(String.fromCharCode(92));
  assert.equal(w('Write', { file_path: conBarrasInvertidas, content: 'status: Hecho' }), RAZON);
  // lo normal sigue pasando
  assert.equal(w('Write', { file_path: tarea, content: '---\nstatus: En curso\n---\n' }), null);
  assert.equal(w('Edit', { file_path: tarea, old_string: 'a', new_string: 'status: Verificando' }), null);
  assert.equal(w('Write', { file_path: 'C:/proyectos personales/demo/README.md', content: 'status: Hecho' }), null);
  assert.equal(w('Edit', { file_path: tarea, old_string: 'x', new_string: 'El estado quedó Hecho en la reunión' }), null);
  assert.equal(w('Write', { file_path: tarea }), null);
  assert.equal(w('Write', { file_path: tarea, content: 42 }), null);
});

test('R3b la puerta de tarjetas cubre rutas relativas, comentarios y cambios solo del valor', () => {
  const w = (tool_name, tool_input) => checkToolCall({ tool_name, tool_input });
  const rel = 'backlog/tasks/task-9 - algo.md';
  assert.equal(w('Write', { file_path: rel, content: 'status: Hecho' }), RAZON);
  assert.equal(w('Edit', { file_path: './backlog/tasks/task-9 - algo.md', old_string: 'a', new_string: 'status: Hecho' }), RAZON);
  assert.equal(w('Write', { file_path: 'C:/p/backlog/tasks/t.md', content: 'status: Hecho # cerrada' }), RAZON);
  assert.equal(w('Write', { file_path: 'C:/p/backlog/tasks/t.md', content: "status:   'done'   " }), RAZON);
  assert.equal(w('Edit', { file_path: 'C:/p/backlog/tasks/t.md', old_string: 'En curso', new_string: 'Hecho' }), RAZON);
  assert.equal(w('Edit', { file_path: 'C:/p/backlog/tasks/t.md', old_string: 'En curso', new_string: '"Done"' }), RAZON);
  assert.equal(w('MultiEdit', { file_path: 'backlog/tasks/t.md', edits: [{ old_string: 'x', new_string: 'Hecho' }] }), RAZON);
  // lo normal y los textos largos que solo mencionan la palabra siguen pasando
  assert.equal(w('Edit', { file_path: 'backlog/tasks/t.md', old_string: 'a', new_string: 'Lo dejamos hecho a medias' }), null);
  assert.equal(w('Edit', { file_path: 'backlog/tasks/t.md', old_string: 'a', new_string: 'En curso' }), null);
  assert.equal(w('Write', { file_path: 'docs/backlog-notas.md', content: 'Hecho' }), null);
  assert.equal(w('Write', { file_path: 'backlog/docs/x.md', content: 'status: Hecho' }), null);
});

test('R3c la puerta normaliza la ruta: .., //, ./, punto final y flujos NTFS no la esquivan', () => {
  const w = (tool_name, tool_input) => checkToolCall({ tool_name, tool_input });
  const hecho = 'status: Hecho';
  for (const p of ['backlog/tasks/../tasks/t.md', 'backlog//tasks/t.md', 'backlog/./tasks/t.md', 'C:/p/backlog/x/../tasks/t.md',
    'backlog/tasks/t.md.', 'backlog/tasks/t.md ', 'backlog/tasks/t.md:flujo', 'BACKLOG/Tasks/T.MD', './x/../backlog/tasks/t.md']) {
    assert.equal(w('Write', { file_path: p, content: hecho }), RAZON, p);
  }
  for (const p of ['.hq/fases.json', './.hq/fases.json', '.hq/../.hq/fases.json', 'C:/p/.hq//fases.json', '.hq/fases.json.', '.hq/fases.json:x']) {
    assert.equal(w('Edit', { file_path: p, old_string: 'a', new_string: 'b' }), RAZON, p);
  }
  assert.equal(w('Write', { file_path: 'backlog/tasks/../docs/t.md', content: hecho }), null);
  assert.equal(w('Write', { file_path: 'otro/.hq/notas.json', content: hecho }), null);
});

test('R3d la puerta de tarjetas reconoce «Hecho» con CRLF, tabuladores y variantes de espacio', () => {
  const w = (content) => checkToolCall({ tool_name: 'Write', tool_input: { file_path: 'backlog/tasks/t.md', content } });
  const crlf = String.fromCharCode(13) + String.fromCharCode(10);
  for (const c of [`---${crlf}status: Hecho${crlf}---${crlf}`, `status: Hecho${String.fromCharCode(13)}`, 'status:Hecho', 'Status : "Hecho"',
    'status:\tDone', `---${crlf}id: T-1${crlf}  status: hecho  ${crlf}`]) {
    assert.equal(w(c), RAZON, JSON.stringify(c));
  }
  assert.equal(w(`status: En curso${crlf}`), null);
  assert.equal(w('El estado Hecho se marca desde hq'), null);
});
