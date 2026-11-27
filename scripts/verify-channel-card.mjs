#!/usr/bin/env node
/**
 * verify-channel-card.mjs — regression tests for the channel-card
 * slot: matchChannel's SOURCE WEIGHTING (Phase 13 fix).
 *
 * The bug: searching "amritvela" showed the BGSJ card. BGSJ's
 * identity carried an 'amritvela' ALIAS (exact match, raw score
 * 1.0) from before the real Amritvela channels existed, while
 * AMRITVELA TRUST's own TITLE only phrase-matches (~0.95) — and the
 * engine compared raw scores, so the alias beat the rightful owner.
 *
 * The rule under test: a title/handle match ALWAYS outranks another
 * channel's alias match (rank = score + 2 for identity candidates),
 * within the same source class the raw score decides. The tests
 * deliberately give BGSJ the STALE aliases (as the DB channels row
 * still carries them until stripped centrally) — the app must be
 * correct even before that cleanup.
 *
 * matchChannel lives in youtubeSearch.ts, which imports React
 * Native modules; this script transpiles it with the project's
 * TypeScript after stubbing exactly two imports (AsyncStorage and
 * the youtube-config flag) — the same pattern as
 * verify-profile-sync.mjs. fuzzy/normalize/config/youtubeError are
 * transpiled for real. No network, no quota.
 *
 * Run:  node scripts/verify-channel-card.mjs   (exit 1 on any FAIL)
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(path.join(repoRoot, 'package.json'));
const ts = require('typescript');

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-verify-card-'));
const searchDir = path.join(repoRoot, 'src', 'features', 'search');

function transpile(name, transform) {
  let source = fs.readFileSync(path.join(searchDir, `${name}.ts`), 'utf8');
  if (transform) source = transform(source);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: `${name}.ts`,
  });
  fs.writeFileSync(path.join(outDir, `${name}.js`), outputText);
}

transpile('normalize');
transpile('fuzzy');
transpile('config');
transpile('youtubeError');
transpile('youtubeSearch', (source) =>
  source
    .replace(
      /import AsyncStorage from '@react-native-async-storage\/async-storage';/,
      'const AsyncStorage = { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined };',
    )
    .replace(
      /import \{ isYouTubeConfigured \} from '\.\.\/\.\.\/lib\/youtube';/,
      'const isYouTubeConfigured = false;',
    ),
);
if (fs.readFileSync(path.join(outDir, 'youtubeSearch.js'), 'utf8').includes('async-storage')) {
  console.error('FAIL  could not stub the AsyncStorage import — script needs updating');
  process.exit(1);
}

const { matchChannel } = require(path.join(outDir, 'youtubeSearch.js'));
const { OFFICIAL_CHANNEL } = require(path.join(outDir, 'config.js'));

// Identities as the app builds them (channelRegistry): title/handle
// from the API, aliases from the DB row / suggested seeds. BGSJ is
// given the STALE programme aliases on purpose — the DB row still
// carries them until the central SQL cleanup lands.
const STALE_BGSJ_ALIASES = ['amritvela', 'amrit vela', 'amritvela samagam'];
const BGSJ = {
  id: OFFICIAL_CHANNEL.id,
  title: OFFICIAL_CHANNEL.title,
  handle: OFFICIAL_CHANNEL.handle,
  aliases: [...OFFICIAL_CHANNEL.aliases, ...STALE_BGSJ_ALIASES],
};
const AMRITVELA_LIVE = {
  id: 'UCsWEj3uf31iAF_STEvO3A2A',
  title: 'AMRITVELA TRUST LIVE',
  handle: '@amritvelatrustlive',
  aliases: ['amritvela trust live', 'amritvela live', 'amritvela'],
};
const AMRITVELA_TRUST = {
  id: 'UCvo6eEtGT5LehydhnMo5sKw',
  title: 'AMRITVELA TRUST',
  handle: '@amritvelatrust',
  aliases: ['amritvela trust', 'amritvela'],
};
const AMRITVELA_TV = {
  id: 'UC2AHnxSbmtaKrk74noBMv-Q',
  title: 'Amritvela TV',
  handle: '@amritvelatv',
  aliases: ['amritvela tv'],
};
const REGISTRY = [BGSJ, AMRITVELA_LIVE, AMRITVELA_TRUST, AMRITVELA_TV];

/** The engine's winner rule: highest source-weighted rank. */
function winner(query, registry = REGISTRY) {
  let best = null;
  for (const identity of registry) {
    const match = matchChannel(query, identity);
    if (match && (!best || match.rank > best.rank)) {
      best = { title: identity.title, ...match };
    }
  }
  return best;
}

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  → ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
}

// 1. THE regression: "amritvela" must show an Amritvela channel's
//    card — never BGSJ's — even while BGSJ still carries the stale
//    alias (exact 1.0) in its identity.
{
  const w = winner('amritvela');
  check('"amritvela" card is an Amritvela channel', w?.title === 'AMRITVELA TRUST' || w?.title === 'AMRITVELA TRUST LIVE', true);
  check('"amritvela" card is NOT BGSJ', w?.title !== BGSJ.title, true);
  // …and the mechanism, stated plainly: BGSJ still matches (via the
  // stale alias) but its rank is below the owner's identity rank.
  const bgsj = matchChannel('amritvela', BGSJ);
  const owner = matchChannel('amritvela', AMRITVELA_TRUST);
  check('stale-alias match exists but ranks below the owner title match', (bgsj?.rank ?? 0) < (owner?.rank ?? 0), true);
}

// 2. The full channel name names its exact owner.
check('"amritvela trust live" card', winner('amritvela trust live')?.title, 'AMRITVELA TRUST LIVE');
check('"amritvela trust" card', winner('amritvela trust')?.title, 'AMRITVELA TRUST');

// 3. Unchanged behaviour for the official channel.
check('"bgsj" card (unchanged)', winner('bgsj')?.title, BGSJ.title);
check('"gursharan" card', winner('gursharan')?.title, BGSJ.title);
check('"bhai gursharan singh ji" card', winner('bhai gursharan singh ji')?.title, BGSJ.title);

// 4. Aliases still work when no identity competes for the term.
check('"ludhiana wale" card via BGSJ alias', winner('ludhiana wale')?.title, BGSJ.title);

// 5. The config cleanup landed: the code fallback identity no longer
//    carries the programme aliases at all.
check(
  'OFFICIAL_CHANNEL aliases no longer contain amritvela terms',
  OFFICIAL_CHANNEL.aliases.some((a) => a.replace(/\s/g, '').includes('amritvela')),
  false,
);

// 6. A nonsense term summons no card at all. (Note: "singh" DOES
//    summon BGSJ — its title phrase-matches at 0.92 — and that
//    predates this fix; it is not part of the regression.)
check('"zzzzqqq" summons no card', winner('zzzzqqq'), null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
