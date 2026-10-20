import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'hq-test-'));
}

export function makeCfg(root) {
  return {
    vaultPath: path.join(root, 'vault'),
    projectsRoot: path.join(root, 'mis proyectos'),
    vaultProjectsDir: 'Proyectos',
    nlmProfile: 'hq',
    basePort: 6430,
    backupsDir: path.join(root, 'backups'),
    logsDir: path.join(root, 'logs'),
    registryFile: path.join(root, 'registry.json'),
    eventsDir: path.join(root, 'events'),
    stateDir: path.join(root, 'state'),
    metricsDir: path.join(root, 'metrics'),
    presupuesto: null,
    eventsRetentionDays: 7,
  };
}

export function writeConfigFile(root) {
  const cfg = makeCfg(root);
  const file = path.join(root, 'config.json');
  writeFileSync(file, JSON.stringify({
    vaultPath: cfg.vaultPath, projectsRoot: cfg.projectsRoot, vaultProjectsDir: cfg.vaultProjectsDir,
    nlmProfile: 'hq', basePort: 6430, backupsDir: 'backups',
  }));
  return { file, cfg };
}

// Runner falso: registra llamadas y simula los efectos de git/backlog/nlm.
export function fakeRunner({ nlmFails = false } = {}) {
  const calls = [];
  const run = (cmd, args, { cwd } = {}) => {
    calls.push({ cmd, args, cwd });
    if (cmd === 'git' && args[0] === 'init') mkdirSync(path.join(cwd, '.git'), { recursive: true });
    if (cmd === 'git' && args[0] === 'diff') return { status: 0, stdout: ' 2 files changed, 10 insertions(+)\n', stderr: '' };
    if (cmd === 'backlog' && args[0] === 'init') {
      mkdirSync(path.join(cwd, 'backlog', 'tasks'), { recursive: true });
      writeFileSync(path.join(cwd, 'backlog', 'config.yml'),
        'project_name: "x"\nstatuses: ["To Do", "In Progress", "Done"]\ndefault_status: "To Do"\n');
    }
    if (cmd === 'nlm') {
      if (nlmFails) return { status: 1, stdout: '', stderr: 'auth expired' };
      return { status: 0, stdout: '{"id":"11111111-2222-3333-4444-555555555555","title":"x"}', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  };
  run.calls = calls;
  return run;
}

// Escribe una tarjeta con el formato real de Backlog.md (listas YAML en bloque).
export function writeTask(repo, n, { title = `Tarea ${n}`, status = 'Planificado', milestone = '', labels = [], deps = [], description = '', criteria = ['criterio'], comments = [] } = {}) {
  const dir = path.join(repo, 'backlog', 'tasks');
  mkdirSync(dir, { recursive: true });
  const lines = [
    '---', `id: TASK-${n}`, `title: ${title}`, `status: ${status}`, 'assignee: []',
    ...(labels.length ? ['labels:', ...labels.map((l) => `  - '${l}'`)] : ['labels: []']),
    ...(milestone ? [`milestone: ${milestone}`] : []),
    ...(deps.length ? ['dependencies:', ...deps.map((d) => `  - ${d}`)] : ['dependencies: []']),
    'ordinal: 1000', '---', '',
    ...(description ? ['## Description', '', '<!-- SECTION:DESCRIPTION:BEGIN -->', description, '<!-- SECTION:DESCRIPTION:END -->', ''] : []),
    '## Acceptance Criteria', '<!-- AC:BEGIN -->', ...criteria.map((c, i) => `- [ ] #${i + 1} ${c}`), '<!-- AC:END -->', '',
    ...(comments.length ? ['## Comments', '', '<!-- COMMENTS:BEGIN -->',
      ...comments.flatMap(({ author = '@revisor', created = '2026-10-12 10:00', text }) => [`author: ${author}`, `created: ${created}`, '---', text, '---', '']),
      '<!-- COMMENTS:END -->', ''] : []),
  ];
  writeFileSync(path.join(dir, `task-${n} - ${title.replace(/\s+/g, '-')}.md`), lines.join('\n'));
}

export function writeMilestone(repo, id, title) {
  const dir = path.join(repo, 'backlog', 'milestones');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${id} - ${title.toLowerCase().replace(/\s+/g, '-')}.md`),
    `---\nid: ${id}\ntitle: "${title}"\n---\n\n## Description\n\nMilestone: ${title}\n`);
}
