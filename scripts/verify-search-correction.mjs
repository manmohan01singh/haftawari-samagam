#!/usr/bin/env node
/**
 * verify-search-correction.mjs — QA issue 91 companion check.
 * deriveCorrection() (engine.ts) replaces each typed token with its
 * best fuzzy vocabulary token at similarity >= 0.8. This script runs
 * the REAL scorer (fuzzy.ts + normalize.ts, transpiled) to prove the
 * typo token 'haftawri' corrects to 'haftawari' under that rule, and
 * that a correct token is left alone. Run: node scripts/verify-search-correction.mjs
 */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repoRoot, 'package.json'));
const ts = require('typescript');
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-verify-corr-'));
for (const name of ['normalize', 'fuzzy']) {
  const source = fs.readFileSync(path.join(repoRoot, 'src/features/search', `${name}.ts`), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: `${name}.ts` });
  fs.writeFileSync(path.join(outDir, `${name}.js`), outputText);
}
const { tokenSimilarity } = require(path.join(outDir, 'fuzzy.js'));
let failures = 0;
const check = (label, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`); if (!cond) failures++; };
const sim = tokenSimilarity('haftawri', 'haftawari');
check("'haftawri' → 'haftawari' similarity >= 0.8 (correction threshold)", sim >= 0.8, `sim=${sim.toFixed(3)}`);
check("'haftawari' is an exact token (no correction needed)", tokenSimilarity('haftawari', 'haftawari') === 1);
check("'zzzz' does not correct to 'haftawari'", tokenSimilarity('zzzz', 'haftawari') < 0.8, `sim=${tokenSimilarity('zzzz','haftawari').toFixed(3)}`);
fs.rmSync(outDir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CORRECTION CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
