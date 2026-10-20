// Redacción automática de datos personales. Todas las expresiones están acotadas (sin retroceso catastrófico).

const MARCA = '[redactado]';

const luhn = (digitos) => {
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    let d = Number(digitos[digitos.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
  }
  return suma % 10 === 0;
};

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const dniValido = (s) => LETRAS_DNI[Number(s.slice(0, 8)) % 23] === s[8].toUpperCase();
const nieValido = (s) => LETRAS_DNI[Number(`${'XYZ'.indexOf(s[0].toUpperCase())}${s.slice(1, 8)}`) % 23] === s[8].toUpperCase();

function ibanValido(texto) {
  const c = texto.replace(/ /g, '').toUpperCase();
  if (c.length < 15 || c.length > 34 || !/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(c)) return false;
  let resto = 0;
  for (const ch of c.slice(4) + c.slice(0, 4)) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of v) resto = (resto * 10 + Number(d)) % 97;
  }
  return resto === 1;
}

const offsetDe =(rest) => rest.find((x) => typeof x === 'number');
const solapa = (rangos, ini, fin) => rangos.some(([a, b]) => ini < b && fin > a);

function rangos(texto, regex) {
  return [...texto.matchAll(regex)].map((m) => [m.index, m.index + m[0].length]);
}

export function redactar(texto, { terminos = [] } = {}) {
  let t = typeof texto === 'string' ? texto : '';
  const cuenta = new Map();
  const sumar = (tipo) => cuenta.set(tipo, (cuenta.get(tipo) ?? 0) + 1);
  const sustituir = (tipo, regex, validar = () => true) => {
    t = t.replace(regex, (m, ...rest) => {
      if (!validar(m, offsetDe(rest))) return m;
      sumar(tipo);
      return MARCA;
    });
  };

  sustituir('token', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g);
  t = t.replace(/\b(password|contraseña|passwd|secret|api[_-]?key|token)(\s{0,3}[:=]\s{0,3})(\S{1,200})/gi, (m, k, sep, valor) => {
    if (valor === MARCA) return m;
    sumar('clave');
    return `${k}${sep}${MARCA}`;
  });
  if (t.includes('@')) sustituir('correo', /[\p{L}\p{N}._+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,8}/gu);
  // IBAN con la forma de siempre (mayúsculas, grupos de 4): se redacta aunque el checksum esté roto por un typo.
  sustituir('iban', /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g);
  // IBAN: forma amplia y validación mod-97; si el patrón arrastra palabras de más, se recorta por la derecha hasta que valida.
  t = t.replace(/\b[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]{1,10}){2,8}\b/g, (m) => {
    let candidato = m;
    while (candidato.length >= 15) {
      if (ibanValido(candidato)) {
        sumar('iban');
        return MARCA + m.slice(candidato.length);
      }
      const corte = candidato.lastIndexOf(' ');
      if (corte < 0) break;
      candidato = candidato.slice(0, corte);
    }
    return m;
  });
  sustituir('dni', /\b\d{8}[- ]?[A-Za-z]\b/g, (m) => dniValido(m.replace(/[- ]/g, '')));
  sustituir('dni', /\b[XYZxyz][- ]?\d{7}[- ]?[A-Za-z]\b/g, (m) => nieValido(m.replace(/[- ]/g, '')));
  sustituir('tarjeta', /\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d) && !/\d{4}-\d{2}-\d{2}/.test(m);
  });

  // Teléfonos con prefijo internacional (+XX o 00XX): antes de proteger los números largos.
  sustituir('telefono', /(?<![\w+])(?:\+|00)\d{1,3}(?:[ .-]?\d){8,12}(?!\d)/g);
  // Teléfonos: no dentro de números largos (referencias, tarjetas que no pasan Luhn) ni de bloques de código con lenguaje.
  const protegidos = [...rangos(t, /(?<!\d)\d(?:[ .-]?\d){11,}(?!\d)/g), ...rangos(t, /```[A-Za-z0-9_+-]+[^\n]*\n[\s\S]*?```/g)];
  sustituir('telefono', /(?<![\w-])(?:\+\d{1,3}[ .-]?)?\d(?:[ .-]?\d){8,10}(?!\d)/g, (m, off) => {
    const d = m.replace(/\D/g, '');
    return d.length >= 9 && !solapa(protegidos, off, off + m.length);
  });

  const lista = [...new Set(terminos.map((x) => String(x).trim()).filter((x) => x.length >= 3))].sort((a, b) => b.length - a.length);
  if (lista.length) {
    sustituir('termino', new RegExp(lista.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi'));
  }

  const orden = ['correo', 'iban', 'dni', 'tarjeta', 'telefono', 'token', 'clave', 'termino'];
  return {
    texto: t,
    coincidencias: orden.filter((k) => cuenta.has(k)).map((k) => ({ tipo: k, cantidad: cuenta.get(k) })),
  };
}
