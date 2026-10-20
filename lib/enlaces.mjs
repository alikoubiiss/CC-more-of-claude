// Enlaces [[…]] de Obsidian: extracción y reescritura, sin tocar bloques de código.

const ENLACE = /(!?)\[\[([^\]|#\n]+?)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g;
const EXT_NO_NOTA = /\.(png|jpe?g|gif|webp|svg|bmp|pdf|mp3|mp4|wav|m4a|mov|webm|base|canvas|zip|csv)$/i;

// Aplica fn solo al texto que no está en un bloque ```/~~~ ni en código en línea.
function fueraDeCodigo(texto, fn) {
  const lineas = texto.split('\n');
  let valla = null;
  const salida = lineas.map((l) => {
    const m = l.match(/^\s*(```+|~~~+)/);
    if (valla) {
      if (m && m[1][0] === valla[0] && m[1].length >= valla.length) valla = null;
      return l;
    }
    if (m) {
      valla = m[1];
      return l;
    }
    return l.split(/(`+[^`\n]*`+)/).map((trozo, i) => (i % 2 === 1 ? trozo : fn(trozo))).join('');
  });
  return salida.join('\n');
}

const sinMd = (d) => d.replace(/\.md$/i, '');

export function extraerEnlaces(texto) {
  const out = [];
  fueraDeCodigo(texto, (parte) => {
    for (const m of parte.matchAll(ENLACE)) {
      out.push({ crudo: m[0], destino: m[2].trim(), ancla: m[3] ?? '', alias: (m[4] ?? '').slice(1), embed: m[1] === '!' });
    }
    return parte;
  });
  return out;
}

export function reescribirEnlaces(texto, resolver) {
  const rotos = new Set();
  const nuevo = fueraDeCodigo(texto, (parte) => parte.replace(ENLACE, (crudo, bang, destino, ancla = '', alias = '') => {
    const d = destino.trim();
    if (!d || EXT_NO_NOTA.test(d)) return crudo;
    const res = resolver(sinMd(d));
    if (res == null) {
      rotos.add(sinMd(d));
      return crudo;
    }
    return `${bang}[[${res}${ancla}${alias}]]`;
  }));
  return { texto: nuevo, rotos: [...rotos].sort() };
}

export function reescribirBase(texto, mapaCarpetas) {
  return texto.replace(/(inFolder\(\s*)(["'])(.*?)\2/g, (todo, pre, q, carpeta) => (
    Object.hasOwn(mapaCarpetas, carpeta) ? `${pre}${q}${mapaCarpetas[carpeta]}${q}` : todo
  ));
}

// Quita los enlaces cuyo destino no se conserva: deja el alias (o el nombre) como texto y elimina los embeds.
export function desenlazar(texto, conservar) {
  return fueraDeCodigo(texto, (parte) => parte.replace(ENLACE, (crudo, bang, destino, ancla = '', alias = '') => {
    const d = sinMd(destino.trim());
    if (!d || conservar(d)) return crudo;
    if (bang) return '';
    return alias ? alias.slice(1) : d.split('/').pop();
  }));
}
