import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

function unquote(value) {
  const s = value.trim();
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
}

// YAML mínimo de Backlog.md: escalares, listas en bloque ("  - x") y listas en línea ("[]", "[a, b]").
function parseFrontmatter(text) {
  const clean = text.replace(/^﻿/, '');
  const m = clean.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: clean };
  const data = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s*(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1]));
      continue;
    }
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const inline = raw.match(/^\[(.*)\]$/);
    if (raw === '') {
      data[key] = [];
      listKey = key;
    } else if (inline) {
      data[key] = inline[1].split(',').map(unquote).filter(Boolean);
      listKey = null;
    } else {
      data[key] = unquote(raw);
      listKey = null;
    }
  }
  return { data, body: clean.slice(m[0].length) };
}

const scalar = (v) => (Array.isArray(v) ? (v[0] ?? '') : (v ?? ''));
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

export function parseTask(text) {
  const { data, body } = parseFrontmatter(text);
  const items = [];
  const ac = body.match(/<!-- AC:BEGIN -->([\s\S]*?)<!-- AC:END -->/);
  if (ac) {
    for (const line of ac[1].split(/\r?\n/)) {
      const m = line.match(/^- \[( |x|X)\] #(\d+)\s+(.*)$/);
      if (m) items.push({ n: Number(m[2]), text: m[3].trim(), done: m[1] !== ' ' });
    }
  }
  const comments = [];
  const cm = body.match(/<!-- COMMENTS:BEGIN -->([\s\S]*?)<!-- COMMENTS:END -->/);
  if (cm) {
    const re = /author:\s*(.*?)\r?\ncreated:\s*(.*?)\r?\n---\r?\n([\s\S]*?)\r?\n---/g;
    let r;
    while ((r = re.exec(cm[1]))) comments.push({ author: r[1].trim(), created: r[2].trim(), text: r[3].trim() });
  }
  const desc = body.match(/<!-- SECTION:DESCRIPTION:BEGIN -->([\s\S]*?)<!-- SECTION:DESCRIPTION:END -->/);
  return {
    id: scalar(data.id),
    title: scalar(data.title),
    status: scalar(data.status),
    milestone: scalar(data.milestone),
    labels: list(data.labels),
    dependencies: list(data.dependencies),
    criteria: { done: items.filter((i) => i.done).length, total: items.length, items },
    comments,
    description: desc ? desc[1].replace(/\r\n/g, '\n').trim() : '',
    updated: scalar(data.updated_date) || scalar(data.created_date),
  };
}

const idNum = (id) => Number(String(id).match(/(\d+)/)?.[1] ?? Number.MAX_SAFE_INTEGER);

function readDir(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
}

export function readTasks(repoPath) {
  const dir = path.join(repoPath, 'backlog', 'tasks');
  const out = [];
  for (const file of readDir(dir)) {
    try {
      const t = parseTask(readFileSync(path.join(dir, file), 'utf8'));
      out.push({ ...t, id: t.id || file, title: t.title || file, file });
    } catch {
      // entrada ilegible (p. ej. un directorio llamado x.md): se omite
    }
  }
  return out.sort((a, b) => idNum(a.id) - idNum(b.id));
}

export function readMilestones(repoPath) {
  const dir = path.join(repoPath, 'backlog', 'milestones');
  const out = [];
  for (const file of readDir(dir)) {
    try {
      const { data } = parseFrontmatter(readFileSync(path.join(dir, file), 'utf8'));
      if (scalar(data.id)) out.push({ id: scalar(data.id), title: scalar(data.title) });
    } catch {
      // se omite
    }
  }
  return out.sort((a, b) => idNum(a.id) - idNum(b.id));
}
