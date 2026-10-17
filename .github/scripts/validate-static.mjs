import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

// Comprobación sintáctica sin ejecutar la aplicación, instalar paquetes ni acceder a pacientes.
let checked = 0;
for (const file of ['index.html', 'bridge-test.html']) {
  const html = readFileSync(new URL('../../' + file, import.meta.url), 'utf8');
  assert.match(html, /<!doctype\s+html>/i, file + ': falta DOCTYPE HTML');
  assert.match(html, /<html\b[^>]*\blang\s*=\s*["']es["']/i, file + ': falta idioma español');
  assert.match(html, /<title>[^<]+<\/title>/i, file + ': falta título');
  assert.match(html, /<\/html>/i, file + ': cierre HTML ausente');
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]).filter(source => source.trim());
  assert.ok(scripts.length, file + ': no se encontraron scripts embebidos');
  for (const [index, source] of scripts.entries()) {
    new Script(source, { filename: file + '#inline-' + (index + 1) });
    checked++;
  }
  process.stdout.write(file + ': estructura básica y JavaScript embebido válido\n');
}
process.stdout.write('Scripts comprobados sin ejecución: ' + checked + '\n');
