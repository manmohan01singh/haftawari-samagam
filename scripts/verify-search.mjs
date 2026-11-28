#!/usr/bin/env node
/**
 * verify-search.mjs — exercises the fuzzy scorer against the REAL
 * December 2020 samagam catalogue titles (verified research, 2026-11-25).
 *
 * The scorer (src/features/search/fuzzy.ts + normalize.ts) is pure TS,
 * so this script transpiles just those two files with the project's own
 * TypeScript and runs assertions in plain Node. No network, no quota.
 *
 * Run:  node scripts/verify-search.mjs     (exit 1 on any FAIL)
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repoRoot, 'package.json'));
const ts = require('typescript');

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-verify-search-'));
for (const name of ['normalize', 'fuzzy']) {
  const source = fs.readFileSync(
    path.join(repoRoot, 'src', 'features', 'search', `${name}.ts`),
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  fs.writeFileSync(path.join(outDir, `${name}.js`), outputText);
}
const { scoreTitle, rankByTitle } = require(path.join(outDir, 'fuzzy.js'));

// The verified Dec 2020 catalogue (titles only — the scorer's test bed).
const TITLES = [
  'Kal Taaran Gur Nanak Aaya',
  'Anand Anand Sab Ko Kahe',
  'Teri Vadiyai Tuhai Jaanda',
  'Suno Benantiya Swami Mere Ram',
  'Simran Abhyaas',
  'Harye Namaste Harye Namah',
  'Jin Prem Kiyo',
  'Jaaye Mila Tina Sajna',
  'Kihre Sewak Te Satgur Ji Di Khushi Hai',
  'Taati Vaao Na Lagai',
  'Haftawari Kirtan Samagam',
];
const CHANNEL_TITLE = 'BHAI GURSHARAN SINGH JI (OFFICIAL CHANNEL)';

let failures = 0;
function check(label, condition, detail) {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}
function topTitle(query, titles = TITLES) {
  const ranked = rankByTitle(query, titles, (t) => t);
  return ranked.length > 0 ? ranked[0] : null;
}

// 1. The headline case: partial, slightly-off query finds the Prakash
//    Purab Haftawari.
{
  const top = topTitle('kal taran');
  check(
    "'kal taran' top-matches 'Kal Taaran Gur Nanak Aaya'",
    top?.item === 'Kal Taaran Gur Nanak Aaya',
    top ? `top="${top.item}" score=${top.score.toFixed(3)} kind=${top.kind}` : 'no results',
  );
}

// 2. Typo tolerance: missing letter in "Haftawari".
{
  const top = topTitle('haftawri');
  check(
    "'haftawri' (typo) top-matches the Haftawari title",
    top?.item === 'Haftawari Kirtan Samagam',
    top ? `top="${top.item}" score=${top.score.toFixed(3)}` : 'no results',
  );
}

// 3. Token reordering must not matter.
{
  const { score } = scoreTitle('nanak aaya gur', 'Kal Taaran Gur Nanak Aaya');
  check("'nanak aaya gur' (reordered) matches", score >= 0.7, `score=${score.toFixed(3)}`);
}

// 4. Typo inside a long transliterated word.
{
  const top = topTitle('benantia swami');
  check(
    "'benantia swami' (typo) top-matches 'Suno Benantiya Swami Mere Ram'",
    top?.item === 'Suno Benantiya Swami Mere Ram',
    top ? `top="${top.item}" score=${top.score.toFixed(3)}` : 'no results',
  );
}

// 5. Prefix typing.
{
  const top = topTitle('simran abh');
  check(
    "'simran abh' (prefix) top-matches 'Simran Abhyaas'",
    top?.item === 'Simran Abhyaas',
    top ? `top="${top.item}" score=${top.score.toFixed(3)}` : 'no results',
  );
}

// 5b. One wrong word must not sink an otherwise exact match
//     (user report, 28 Nov 2026): "karta purakh vkhaniye" vs the real
//     Amritvela Trust Live title "Vich Karta Purakh Khloa | ...".
{
  const { score } = scoreTitle(
    'Karta purakh vkhaniye',
    'Vich Karta Purakh Khloa | Amritvela Live Kirtan Darbar | Bhai Saheb Bhai Gurpreet Singh Rinku Veerji',
  );
  check(
    "'karta purakh vkhaniye' (one wrong word) still matches 'Vich Karta Purakh Khloa'",
    score >= 0.45,
    `score=${score.toFixed(3)}`,
  );
}

// 5c. Channel-name words + a spelling variant must not sink a match
//     (user report, 28 Nov 2026): "Jis da karta mittar Amritvela trust"
//     — "Amritvela trust" names the channel, and the title spells the
//     function word "Ka" where the user typed "da". The title's every
//     content word matches; the score must clear the threshold on the
//     full query alone (the engine additionally strips channel words
//     per channel, which only helps further).
{
  const { score } = scoreTitle(
    'Jis da karta mittar Amritvela trust',
    'Jis Ka Karta Mittar Hai | Amritvela Kirtan Darbar | Bhai Gurpreet Singh Ji',
  );
  check(
    "'jis da karta mittar amritvela trust' matches 'Jis Ka Karta Mittar Hai'",
    score >= 0.45,
    `score=${score.toFixed(3)}`,
  );
}

// 5d. Junk must still fail even with the two-worst forgiveness: only
//     two real words hidden in a five-word junk query is not a match.
{
  const { score } = scoreTitle(
    'karta purakh zqxwv plmno nbvtr',
    'Vich Karta Purakh Khloa | Amritvela Live Kirtan Darbar',
  );
  check(
    "junk padding around two real words still scores below threshold",
    score < 0.45,
    `score=${score.toFixed(3)}`,
  );
}

// 6. Acronym: how the sangat refers to the channel ("bgsj" is literally
//    the query in reference screenshot 03).
{
  const { score, kind } = scoreTitle('bgsj', CHANNEL_TITLE);
  check("'bgsj' matches the channel by acronym", kind === 'acronym' && score >= 0.7, `score=${score.toFixed(3)} kind=${kind}`);
}

// 7. Gurmukhi script: phrase in the same script matches.
{
  const { score, kind } = scoreTitle('ਕਲ ਤਾਰਨ', 'ਕਲ ਤਾਰਨ ਗੁਰ ਨਾਨਕ ਆਇਆ');
  check('Gurmukhi phrase matches Gurmukhi title', score >= 0.9, `score=${score.toFixed(3)} kind=${kind}`);
}

// 8. Garbage matches nothing above threshold.
{
  const ranked = rankByTitle('zzzz qqqq', TITLES, (t) => t);
  check("'zzzz qqqq' returns no results", ranked.length === 0, `${ranked.length} results`);
}

// 9. A real word does not drag in an unrelated title as top hit.
{
  const top = topTitle('simran');
  check(
    "'simran' top-matches 'Simran Abhyaas' (not an unrelated title)",
    top?.item === 'Simran Abhyaas',
    top ? `top="${top.item}" score=${top.score.toFixed(3)}` : 'no results',
  );
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
