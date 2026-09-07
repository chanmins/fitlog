#!/usr/bin/env node
/**
 * 버전 올리기 — 한 번에, 전부.
 *
 *   node scripts/bump-version.mjs 96
 *   node scripts/bump-version.mjs          # 지금 값에서 +1
 *
 * 왜 필요한가:
 * 버전 문자열은 index.html 의 BUILD 상수와 여섯 개 `?v=`, 그리고 sw.js 의
 * BUILD 상수에 흩어져 있다. 빌드 단계가 없으므로 릴리스마다 사람이 이걸
 * 손으로 맞춰야 했고, 한 곳만 빠뜨리면 서비스워커는 `app.js?v=96` 을 미리
 * 받아 두는데 페이지는 `app.js?v=95` 를 요청하는 상태가 된다. 같은 파일을
 * 두 번 받고, 캐시는 어긋난 채로 남고, 증상은 '가끔 예전 화면이 뜬다' 로만
 * 보여서 원인을 찾기 어렵다.
 *
 * 고치는 자리를 세어서 알려 준다. 예상과 다르면 그 자체가 신호다.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = join(root, 'index.html');
const SW = join(root, 'sw.js');

const BUILD_RE = /(\bBUILD\s*=\s*")(\d+)(")/;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const indexSrc = await readFile(INDEX, 'utf8');
const swSrc = await readFile(SW, 'utf8');

const current = indexSrc.match(BUILD_RE)?.[2];
if (!current) fail('index.html 에서 BUILD 값을 찾지 못했어요.');

const arg = process.argv[2];
const next = arg ? String(arg).trim() : String(Number(current) + 1);
if (!/^\d+$/.test(next)) fail(`버전은 숫자여야 해요 (받은 값: ${arg})`);
if (next === current) fail(`이미 ${current} 예요.`);

const swCurrent = swSrc.match(BUILD_RE)?.[2];
if (!swCurrent) fail('sw.js 에서 BUILD 값을 찾지 못했어요.');
if (swCurrent !== current) {
  console.warn(`⚠ index.html 은 ${current}, sw.js 는 ${swCurrent} 였어요 — 지금 맞춥니다.`);
}

/* index.html: BUILD 상수 하나 + 스크립트/스타일 태그의 ?v= 전부 */
let tagCount = 0;
const nextIndex = indexSrc
  .replace(BUILD_RE, `$1${next}$3`)
  .replace(/\?v=\d+/g, () => {
    tagCount++;
    return `?v=${next}`;
  });

if (tagCount === 0) fail('index.html 에서 ?v= 를 하나도 찾지 못했어요 — 형식이 바뀐 것 같아요.');

/* sw.js: BUILD 상수 하나. CACHE 와 ASSETS 는 거기서 파생된다. */
const nextSw = swSrc.replace(BUILD_RE, `$1${next}$3`);

await writeFile(INDEX, nextIndex);
await writeFile(SW, nextSw);

console.log(`✓ ${current} → ${next}`);
console.log(`  index.html  BUILD 1곳 · ?v= ${tagCount}곳`);
console.log(`  sw.js       BUILD 1곳 (CACHE·ASSETS 는 여기서 파생)`);
console.log('');
console.log('  남은 ?v= 를 확인하려면:  grep -n "v=[0-9]" index.html sw.js');
