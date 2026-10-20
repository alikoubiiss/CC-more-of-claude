const RESERVED = new Set([
  'con', 'prn', 'aux', 'nul', 'project-hq',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function slugify(raw) {
  return String(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function validateName(raw) {
  const slug = slugify(raw ?? '');
  if (!slug) return { ok: false, error: 'El nombre no contiene letras ni números' };
  if (slug.length > 40) return { ok: false, error: 'El nombre es demasiado largo (máx. 40 caracteres)' };
  if (RESERVED.has(slug)) return { ok: false, error: `"${slug}" es un nombre reservado` };
  return { ok: true, slug, display: String(raw).trim() };
}
