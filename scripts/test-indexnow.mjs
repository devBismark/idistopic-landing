#!/usr/bin/env node

import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  CANONICAL_ORIGIN,
  CANONICAL_HOST,
  getIndexNowKeyInfo,
  parseSitemapUrls,
  diffSitemaps,
  mapFileToUrls,
  detectAffectedUrls,
  analyzeChanges,
  validateAndDeduplicateUrls,
  verifyProductionGate,
  submitToIndexNow,
  sha256,
  normalizeContent
} from './indexnow-submit.mjs';

const SITEMAP_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.idistopic.com/</loc>
  </url>
  <url>
    <loc>https://www.idistopic.com/solucoes</loc>
  </url>
  <url>
    <loc>https://www.idistopic.com/trabalhos</loc>
  </url>
</urlset>`;

async function runTests() {
  console.log('====================================================');
  console.log(' IDISTØPIC — IndexNow Hardened Test Suite');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // A. index.html alterado -> somente /
  test('A: index.html changed -> only https://www.idistopic.com/', () => {
    const urls = detectAffectedUrls(['index.html'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, [`${CANONICAL_ORIGIN}/`]);
  });

  // B. solucoes.html alterado -> somente /solucoes
  test('B: solucoes.html changed -> only https://www.idistopic.com/solucoes', () => {
    const urls = detectAffectedUrls(['solucoes.html'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, [`${CANONICAL_ORIGIN}/solucoes`]);
  });

  // C. trabalhos.html alterado -> somente /trabalhos
  test('C: trabalhos.html changed -> only https://www.idistopic.com/trabalhos', () => {
    const urls = detectAffectedUrls(['trabalhos.html'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, [`${CANONICAL_ORIGIN}/trabalhos`]);
  });

  // C2. web.html alterado -> somente /web
  test('C2: web.html changed -> only https://www.idistopic.com/web', () => {
    const urls = detectAffectedUrls(['web.html'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, [`${CANONICAL_ORIGIN}/web`]);
  });

  // D. secondary-v1.css -> /solucoes + /trabalhos
  test('D: secondary-v1.css changed -> /solucoes and /trabalhos', () => {
    const urls = detectAffectedUrls(['secondary-v1.css'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls.sort(), [`${CANONICAL_ORIGIN}/solucoes`, `${CANONICAL_ORIGIN}/trabalhos`].sort());
  });

  // D2. web.css e web.js -> /web
  test('D2: web.css/web.js changed -> only /web', () => {
    const urlsCss = detectAffectedUrls(['web.css'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urlsCss, [`${CANONICAL_ORIGIN}/web`]);
    const urlsJs = detectAffectedUrls(['web.js'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urlsJs, [`${CANONICAL_ORIGIN}/web`]);
  });

  // E. homepage-v1.js -> /
  test('E: homepage-v1.js changed -> only /', () => {
    const urls = detectAffectedUrls(['homepage-v1.js'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, [`${CANONICAL_ORIGIN}/`]);
  });

  // F. arquivo em .github/ -> nenhuma URL
  test('F: .github/ workflow changed -> zero public URLs (skip)', () => {
    const urls = detectAffectedUrls(['.github/workflows/indexnow.yml'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, []);
  });

  // G. script de automacao -> nenhuma URL
  test('G: scripts/ script changed -> zero public URLs (skip)', () => {
    const urls = detectAffectedUrls(['scripts/indexnow-submit.mjs'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, []);
  });

  // H. key .txt -> nenhuma URL
  test('H: IndexNow key file changed -> zero public URLs (skip)', () => {
    const urls = detectAffectedUrls(['bc992d628f21476d9a4d4a8dcaf72f1c.txt'], { currentSitemap: SITEMAP_SAMPLE });
    assert.deepEqual(urls, []);
  });

  // I. URL externa injetada -> rejeitada
  test('I: External or malformed URLs rejected by guardrails', () => {
    const input = [
      'https://www.google.com/search',
      'https://otherdomain.com/solucoes',
      'not-a-valid-url',
      'http://malicious.org/exploit',
      `${CANONICAL_ORIGIN}/solucoes`
    ];
    const filtered = validateAndDeduplicateUrls(input);
    assert.deepEqual(filtered, [`${CANONICAL_ORIGIN}/solucoes`]);
  });

  // J. duplicatas -> deduplicadas
  test('J: Duplicate URLs deduplicated', () => {
    const input = [
      `${CANONICAL_ORIGIN}/solucoes`,
      `${CANONICAL_ORIGIN}/solucoes`,
      `${CANONICAL_ORIGIN}/`,
      `${CANONICAL_ORIGIN}/`,
      `${CANONICAL_ORIGIN}/trabalhos`
    ];
    const deduped = validateAndDeduplicateUrls(input);
    assert.deepEqual(deduped, [
      `${CANONICAL_ORIGIN}/solucoes`,
      `${CANONICAL_ORIGIN}/`,
      `${CANONICAL_ORIGIN}/trabalhos`
    ]);
  });

  // K. sitemap com nova URL -> nova URL detectada
  test('K: Sitemap adding new page detected', () => {
    const sitemapBefore = SITEMAP_SAMPLE;
    const sitemapAfter = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.idistopic.com/</loc></url>
  <url><loc>https://www.idistopic.com/solucoes</loc></url>
  <url><loc>https://www.idistopic.com/trabalhos</loc></url>
  <url><loc>https://www.idistopic.com/novapagina</loc></url>
</urlset>`;

    const analysis = analyzeChanges(['sitemap.xml'], {
      sitemapBefore,
      sitemapAfter,
      currentSitemap: sitemapAfter
    });
    assert.deepEqual(analysis.affectedUrls, [`${CANONICAL_ORIGIN}/novapagina`]);
    assert.deepEqual(analysis.addedUrls, [`${CANONICAL_ORIGIN}/novapagina`]);
  });

  // L. sitemap removendo URL -> URL removida detectada
  test('L: Sitemap removing page detected', () => {
    const sitemapBefore = SITEMAP_SAMPLE;
    const sitemapAfter = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.idistopic.com/</loc></url>
  <url><loc>https://www.idistopic.com/solucoes</loc></url>
</urlset>`;

    const analysis = analyzeChanges(['sitemap.xml'], {
      sitemapBefore,
      sitemapAfter,
      currentSitemap: sitemapAfter
    });
    assert.deepEqual(analysis.affectedUrls, [`${CANONICAL_ORIGIN}/trabalhos`]);
    assert.deepEqual(analysis.removedUrls, [`${CANONICAL_ORIGIN}/trabalhos`]);
  });

  // M. HTTP 200 OK -> PASS
  await testAsync('M: IndexNow API HTTP 200 OK -> PASS', async () => {
    const mockFetch = async () => ({
      status: 200,
      text: async () => 'OK'
    });
    const payload = { host: CANONICAL_HOST, key: 'mockkey', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    const res = await submitToIndexNow(payload, { fetchFn: mockFetch });
    assert.equal(res.status, 200);
    assert.equal(res.success, true);
  });

  // N. HTTP 202 Accepted -> WARNING/accepted (PASS)
  await testAsync('N: IndexNow API HTTP 202 Accepted -> WARNING/accepted (PASS)', async () => {
    const mockFetch = async () => ({
      status: 202,
      text: async () => 'Accepted'
    });
    const payload = { host: CANONICAL_HOST, key: 'mockkey', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    const res = await submitToIndexNow(payload, { fetchFn: mockFetch });
    assert.equal(res.status, 202);
    assert.equal(res.success, true);
    assert.equal(res.warning, true);
  });

  // O1. HTTP 400 Bad Request -> FAIL imediatamente sem retries
  await testAsync('O1: IndexNow API HTTP 400 Bad Request -> FAIL immediately without retry', async () => {
    let callCount = 0;
    const mockFetch400 = async () => {
      callCount++;
      return { status: 400, text: async () => 'Bad Request: Invalid format' };
    };
    const payload = { host: CANONICAL_HOST, key: 'mockkey', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    await assert.rejects(async () => {
      await submitToIndexNow(payload, { fetchFn: mockFetch400, maxRetries: 3, retryDelayMs: 10 });
    }, /HTTP 400/);
    assert.equal(callCount, 1, 'Expected exactly 1 attempt for 400 client error');
  });

  // O2. HTTP 403 Forbidden -> FAIL imediatamente sem retries
  await testAsync('O2: IndexNow API HTTP 403 Forbidden -> FAIL immediately without retry', async () => {
    let callCount = 0;
    const mockFetch403 = async () => {
      callCount++;
      return { status: 403, text: async () => 'Forbidden: Key not valid' };
    };
    const payload = { host: CANONICAL_HOST, key: 'invalid', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    await assert.rejects(async () => {
      await submitToIndexNow(payload, { fetchFn: mockFetch403, maxRetries: 3, retryDelayMs: 10 });
    }, /HTTP 403/);
    assert.equal(callCount, 1, 'Expected exactly 1 attempt for 403 client error');
  });

  // O3. HTTP 422 Unprocessable Entity -> FAIL imediatamente sem retries
  await testAsync('O3: IndexNow API HTTP 422 Unprocessable Entity -> FAIL immediately without retry', async () => {
    let callCount = 0;
    const mockFetch422 = async () => {
      callCount++;
      return { status: 422, text: async () => 'Unprocessable Entity: URL not in domain' };
    };
    const payload = { host: CANONICAL_HOST, key: 'mockkey', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    await assert.rejects(async () => {
      await submitToIndexNow(payload, { fetchFn: mockFetch422, maxRetries: 3, retryDelayMs: 10 });
    }, /HTTP 422/);
    assert.equal(callCount, 1, 'Expected exactly 1 attempt for 422 client error');
  });

  // P. HTTP 429 Too Many Requests -> limited retry and failure handling
  await testAsync('P: IndexNow API HTTP 429 Too Many Requests -> limited retry and FAIL if persists', async () => {
    let callCount = 0;
    const mockFetch429 = async () => {
      callCount++;
      return { status: 429, text: async () => 'Rate limit exceeded' };
    };
    const payload = { host: CANONICAL_HOST, key: 'mockkey', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    await assert.rejects(async () => {
      await submitToIndexNow(payload, { fetchFn: mockFetch429, maxRetries: 3, retryDelayMs: 10 });
    }, /HTTP 429 after 3 attempts/);
    assert.equal(callCount, 3);
  });

  // Q. HTTP 500/502/503 -> limited retry and failure handling
  await testAsync('Q: IndexNow API HTTP 500/502/503 Server Error -> limited retry and FAIL if persists', async () => {
    let callCount = 0;
    const mockFetch503 = async () => {
      callCount++;
      return { status: 503, text: async () => 'Service Unavailable' };
    };
    const payload = { host: CANONICAL_HOST, key: 'mockkey', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    await assert.rejects(async () => {
      await submitToIndexNow(payload, { fetchFn: mockFetch503, maxRetries: 3, retryDelayMs: 10 });
    }, /HTTP 503 after 3 attempts/);
    assert.equal(callCount, 3);
  });

  // R. HTTP 5xx that recovers on subsequent attempt -> PASS
  await testAsync('R: IndexNow API HTTP 5xx that recovers on 2nd attempt -> PASS', async () => {
    let callCount = 0;
    const mockFetchRecover = async () => {
      callCount++;
      if (callCount === 1) {
        return { status: 500, text: async () => 'Internal Server Error' };
      }
      return { status: 200, text: async () => 'OK' };
    };
    const payload = { host: CANONICAL_HOST, key: 'mockkey', keyLocation: 'https://www.idistopic.com/key.txt', urlList: [`${CANONICAL_ORIGIN}/`] };
    const res = await submitToIndexNow(payload, { fetchFn: mockFetchRecover, maxRetries: 3, retryDelayMs: 10 });
    assert.equal(res.status, 200);
    assert.equal(res.success, true);
    assert.equal(callCount, 2);
  });

  // S. CRITICAL: Production Gate for static asset change (secondary-v1.css)
  await testAsync('S: Production Gate for changed asset (secondary-v1.css) blocks when remote CSS is old, passes when updated', async () => {
    // Scenario 1: HTML is 200 OK, but remote secondary-v1.css is NOT matching local CSS
    const mockFetchOldCss = async (url) => {
      if (url.includes('secondary-v1.css')) {
        return {
          status: 200,
          text: async () => '/* OLD SECONDARY CSS */'
        };
      }
      return {
        status: 200,
        text: async () => '<html>solucoes</html>'
      };
    };

    await assert.rejects(async () => {
      await verifyProductionGate({
        changedFiles: ['secondary-v1.css'],
        affectedUrls: [`${CANONICAL_ORIGIN}/solucoes`, `${CANONICAL_ORIGIN}/trabalhos`]
      }, {
        timeoutMs: 50,
        pollIntervalMs: 10,
        fetchFn: mockFetchOldCss
      });
    }, /Content hash mismatch for https:\/\/www\.idistopic\.com\/secondary-v1\.css/);

    // Scenario 2: Remote secondary-v1.css matches local file content exactly
    const localCss = fs.readFileSync('secondary-v1.css', 'utf8');
    const mockFetchNewCss = async (url) => {
      if (url.includes('secondary-v1.css')) {
        return {
          status: 200,
          text: async () => localCss
        };
      }
      return {
        status: 200,
        text: async () => '<html>ok</html>'
      };
    };

    const gateResult = await verifyProductionGate({
      changedFiles: ['secondary-v1.css'],
      affectedUrls: [`${CANONICAL_ORIGIN}/solucoes`, `${CANONICAL_ORIGIN}/trabalhos`]
    }, {
      timeoutMs: 500,
      pollIntervalMs: 10,
      fetchFn: mockFetchNewCss
    });

    assert.equal(gateResult, true, 'Gate must pass when remote CSS matches local CSS');
  });

  // T. Production Gate for removed URL
  await testAsync('T: Production Gate for removed URL blocks until production sitemap no longer lists it', async () => {
    // Scenario 1: remote sitemap still has removed URL
    const mockFetchOldSitemap = async (url) => {
      if (url.includes('sitemap.xml')) {
        return {
          status: 200,
          text: async () => SITEMAP_SAMPLE
        };
      }
      return { status: 200, text: async () => 'ok' };
    };

    await assert.rejects(async () => {
      await verifyProductionGate({
        removedUrls: [`${CANONICAL_ORIGIN}/trabalhos`]
      }, {
        timeoutMs: 50,
        pollIntervalMs: 10,
        fetchFn: mockFetchOldSitemap
      });
    }, /Production sitemap\.xml still contains removed URL/);

    // Scenario 2: remote sitemap no longer has removed URL
    const sitemapWithoutTrabalhos = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.idistopic.com/</loc></url>
  <url><loc>https://www.idistopic.com/solucoes</loc></url>
</urlset>`;

    const mockFetchNewSitemap = async (url) => {
      if (url.includes('sitemap.xml')) {
        return {
          status: 200,
          text: async () => sitemapWithoutTrabalhos
        };
      }
      return { status: 200, text: async () => 'ok' };
    };

    const passResult = await verifyProductionGate({
      removedUrls: [`${CANONICAL_ORIGIN}/trabalhos`]
    }, {
      timeoutMs: 500,
      pollIntervalMs: 10,
      fetchFn: mockFetchNewSitemap
    });

    assert.equal(passResult, true);
  });

  console.log('\n====================================================');
  console.log(` Test Summary: ${passed} passed, ${failed} failed.`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
