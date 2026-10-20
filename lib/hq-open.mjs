import path from 'node:path';

const SLUG_RE = /^[a-z0-9-]+$/;

// Argumentos de wt.exe: cada ';' va como argumento suelto (separador de comandos de Windows Terminal).
export function buildWtArgs({ slug, repo, claudeCmd = 'claude', tui = 'cc', window = 'new', maximized = true, colorScheme = 'HQ' }) {
  if (!SLUG_RE.test(String(slug))) throw new Error(`hq-open: slug inválido: ${slug}`);
  if (!path.isAbsolute(String(repo))) throw new Error('hq-open: la ruta del proyecto debe ser absoluta');
  // Mismo esquema en los tres paneles para que no haya costuras de color (si no existe en WT, cae al por defecto).
  const cs = colorScheme ? ['--colorScheme', colorScheme] : [];
  // El tablero lleva HQ_LAYOUT=<slug>: así sabe que el panel de su izquierda es el Claude de este proyecto y puede
  // enviarle e/v (tui/hq/panel.py). `&&` va pegado al valor para que `set` no guarde un espacio final; el slug ya
  // está validado, así que no hay nada que escapar para cmd.
  const tablero = ['cmd', '/c', 'set', `HQ_LAYOUT=${slug}&&`, tui, 'board', slug];
  return [
    '-w', window,
    ...(maximized ? ['--maximized'] : []),
    'new-tab', '--title', slug, ...cs, '-d', repo, 'cmd', '/k', claudeCmd,
    ';', 'split-pane', '-V', '-s', '0.42', ...cs, '-d', repo, ...tablero,
    ';', 'split-pane', '-H', '-s', '0.5', ...cs, '-d', repo, tui, 'focus', slug,
    ';', 'move-focus', 'left',
  ];
}
