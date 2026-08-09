'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { validateScript } = require('./scriptRunner');

function loadScriptFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const doc = yaml.load(raw);
  if (!doc || typeof doc !== 'object') throw new Error(`Invalid YAML: ${filePath}`);
  if (!doc.id) throw new Error(`Script missing id: ${filePath}`);
  if (!Array.isArray(doc.steps)) throw new Error(`Script missing steps: ${doc.id}`);
  doc.pack = doc.pack || 'c';
  doc.timeout_ms = doc.timeout_ms || 45_000;
  validateScript(doc);
  return doc;
}

function listScriptFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => {
      const abs = path.join(dir, f);
      try {
        const doc = loadScriptFile(abs);
        return { id: doc.id, pack: doc.pack, path: abs, doc };
      } catch (error) {
        let partial;
        try {
          partial = yaml.load(fs.readFileSync(abs, 'utf8'));
        } catch (_) {
          partial = null;
        }
        return {
          id: typeof partial?.id === 'string' && partial.id
            ? partial.id
            : path.basename(f, path.extname(f)),
          pack: partial?.pack || 'c',
          path: abs,
          error,
        };
      }
    });
}

module.exports = { loadScriptFile, listScriptFiles };
