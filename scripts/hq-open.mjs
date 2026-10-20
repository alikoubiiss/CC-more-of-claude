import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadConfig } from '../lib/config.mjs';
import { isMain } from '../lib/cli.mjs';
import { buildWtArgs } from '../lib/hq-open.mjs';
import { loadRegistry } from '../lib/registry.mjs';

function spawnWt(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('wt.exe', args, { detached: true, stdio: 'ignore' });
    child.once('error', (e) => reject(new Error(`hq-open: no se pudo lanzar wt.exe: ${e.message}`)));
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export async function runHqOpen({ slug, reg, dryRun = false, spawnFn = spawnWt, opts = {} }) {
  const project = reg.projects.find((p) => p.slug === slug);
  if (!project) throw new Error(`hq-open: no hay un proyecto registrado llamado "${slug}"`);
  if (!existsSync(project.path)) throw new Error(`hq-open: no existe la carpeta ${project.path}`);
  const args = buildWtArgs({ slug, repo: project.path, ...opts });
  if (!dryRun) await spawnFn(args);
  return { args };
}

if (isMain(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const slug = argv.find((a) => !a.startsWith('--'));
    if (!slug) throw new Error('uso: node scripts/hq-open.mjs <proyecto> [--dry-run]');
    const cfg = loadConfig();
    const { args } = await runHqOpen({ slug, reg: loadRegistry(cfg.registryFile), dryRun });
    if (dryRun) console.log(JSON.stringify(args));
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
  }
}
