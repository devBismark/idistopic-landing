#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

export const CANONICAL_HOST = 'www.idistopic.com';
export const CANONICAL_ORIGIN = `https://${CANONICAL_HOST}`;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

/**
 * Locate and read the IndexNow key file from repo root.
 */
export function getIndexNowKeyInfo(rootDir = REPO_ROOT) {
  const files = fs.readdirSync(rootDir);
  const keyFile = files.find(f => /^[a-f0-9]{32}\.txt$/i.test(f));
  if (!keyFile) {
    throw new Error('IndexNow key file ([a-f0-9]{32}.txt) not found in repository root.');
  }
  const key = fs.readFileSync(path.join(rootDir, keyFile), 'utf8').trim();
  if (!key || key.length !== 32) {
    throw new Error(`Invalid IndexNow key in ${keyFile}: expected 32 hex characters.`);
  }
  return {
    key,
    keyFile,
    keyLocation: `${CANONICAL_ORIGIN}/${keyFile}`
  };
}

/**
 * Parse canonical URLs from a sitemap XML string.
 */
export function parseSitemapUrls(xmlContent) {
  if (!xmlContent) return [];
  const urls = [];
  const locRegex = /<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xmlContent)) !== null) {
    const rawUrl = match[1].trim();
    try {
      const u = new URL(rawUrl);
      if (u.hostname === CANONICAL_HOST) {
        urls.push(u.href);
      }
    } catch {
      // ignore malformed loc
    }
  }
  return Array.from(new Set(urls));
}

/**
 * Compare two sitemap XML strings to detect added and removed URLs.
 */
export function diffSitemaps(beforeXml, afterXml) {
  const beforeUrls = new Set(parseSitemapUrls(beforeXml));
  const afterUrls = new Set(parseSitemapUrls(afterXml));

  const added = Array.from(afterUrls).filter(u => !beforeUrls.has(u));
  const removed = Array.from(beforeUrls).filter(u => !afterUrls.has(u));

  return { added, removed };
}

/**
 * Map a single modified file path to affected canonical public URLs.
 */
export function mapFileToUrls(filePath, sitemapUrls = []) {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '');

  // Non-public files and internal tooling to skip
  if (
    normalized.startsWith('.github/') ||
    normalized.startsWith('scripts/') ||
    normalized.startsWith('.unlazy/') ||
    normalized.startsWith('.git/') ||
    normalized.endsWith('.md') ||
    /^[a-f0-9]{32}\.txt$/i.test(normalized) ||
    normalized === 'robots.txt' ||
    normalized === '.gitignore' ||
    normalized === 'mini-demo-orcamento.html' ||
    normalized === 'landing-pages.html'
  ) {
    return [];
  }

  // Direct HTML page mapping
  if (normalized === 'index.html') {
    return [`${CANONICAL_ORIGIN}/`];
  }
  if (normalized === 'solucoes.html') {
    return [`${CANONICAL_ORIGIN}/solucoes`];
  }
  if (normalized === 'trabalhos.html') {
    return [`${CANONICAL_ORIGIN}/trabalhos`];
  }
  if (normalized === 'web.html') {
    return [`${CANONICAL_ORIGIN}/web`];
  }

  // Page-specific CSS/JS
  if (normalized === 'homepage-v1.css' || normalized === 'homepage-v1.js') {
    return [`${CANONICAL_ORIGIN}/`];
  }
  if (normalized === 'secondary-v1.css' || normalized === 'secondary-v1.js') {
    return [`${CANONICAL_ORIGIN}/solucoes`, `${CANONICAL_ORIGIN}/trabalhos`];
  }
  if (normalized === 'web.css' || normalized === 'web.js') {
    return [`${CANONICAL_ORIGIN}/web`];
  }

  // Assets
  if (normalized.startsWith('assets/')) {
    // Shared brand assets or fonts affect all canonical pages
    if (
      normalized.startsWith('assets/brand/favicon') ||
      normalized.startsWith('assets/brand/apple-touch-icon') ||
      normalized.startsWith('assets/brand/og-') ||
      normalized.startsWith('assets/fonts/')
    ) {
      return sitemapUrls.length > 0 ? sitemapUrls : [`${CANONICAL_ORIGIN}/`, `${CANONICAL_ORIGIN}/solucoes`, `${CANONICAL_ORIGIN}/trabalhos`, `${CANONICAL_ORIGIN}/web`];
    }
    // Specific images
    if (normalized === 'assets/brand/idistopic-lockup.png' || normalized === 'assets/brand/idistopic-symbol.png') {
      return [`${CANONICAL_ORIGIN}/`];
    }
    if (normalized === 'assets/fb-restauracoes.jpg') {
      return [`${CANONICAL_ORIGIN}/`, `${CANONICAL_ORIGIN}/trabalhos`];
    }
    // Fallback for any other asset: affect all known sitemap URLs
    return sitemapUrls.length > 0 ? sitemapUrls : [`${CANONICAL_ORIGIN}/`, `${CANONICAL_ORIGIN}/solucoes`, `${CANONICAL_ORIGIN}/trabalhos`, `${CANONICAL_ORIGIN}/web`];
  }

  // vercel.json routing changes potentially affect all canonical pages
  if (normalized === 'vercel.json') {
    return sitemapUrls.length > 0 ? sitemapUrls : [`${CANONICAL_ORIGIN}/`, `${CANONICAL_ORIGIN}/solucoes`, `${CANONICAL_ORIGIN}/trabalhos`, `${CANONICAL_ORIGIN}/web`];
  }

  return [];
}

/**
 * Detailed analysis of changed files, returning affected URLs, added URLs and removed URLs.
 */
export function analyzeChanges(changedFiles, { sitemapBefore = '', sitemapAfter = '', currentSitemap = '' } = {}) {
  const currentUrls = currentSitemap ? parseSitemapUrls(currentSitemap) : [];
  let affected = [];
  let addedUrls = [];
  let removedUrls = [];

  const sitemapChanged = changedFiles.some(f => f.replace(/\\/g, '/') === 'sitemap.xml');
  if (sitemapChanged && sitemapBefore && sitemapAfter) {
    const diff = diffSitemaps(sitemapBefore, sitemapAfter);
    addedUrls = diff.added;
    removedUrls = diff.removed;
    affected.push(...addedUrls, ...removedUrls);
  }

  for (const file of changedFiles) {
    if (file.replace(/\\/g, '/') === 'sitemap.xml') continue;
    const urls = mapFileToUrls(file, currentUrls);
    affected.push(...urls);
  }

  return {
    affectedUrls: validateAndDeduplicateUrls(affected),
    addedUrls: validateAndDeduplicateUrls(addedUrls),
    removedUrls: validateAndDeduplicateUrls(removedUrls),
    changedFiles: changedFiles.map(f => f.replace(/\\/g, '/'))
  };
}

/**
 * Map a list of changed files and sitemap diff to the set of affected canonical URLs.
 */
export function detectAffectedUrls(changedFiles, { sitemapBefore = '', sitemapAfter = '', currentSitemap = '' } = {}) {
  return analyzeChanges(changedFiles, { sitemapBefore, sitemapAfter, currentSitemap }).affectedUrls;
}

/**
 * Validate guardrails and deduplicate URL list.
 */
export function validateAndDeduplicateUrls(urls) {
  const valid = [];
  for (const raw of urls) {
    if (!raw || typeof raw !== 'string') continue;
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') {
        continue;
      }
      if (u.hostname !== CANONICAL_HOST) {
        // Rejects non-canonical domains
        continue;
      }
      valid.push(u.href);
    } catch {
      // Rejects malformed URLs
    }
  }

  const deduped = Array.from(new Set(valid));
  if (deduped.length > 10000) {
    throw new Error(`URL count exceeds IndexNow limit of 10,000 URLs (got ${deduped.length}).`);
  }
  return deduped;
}

/**
 * Fetch git diff changed files between before and after commits.
 */
export function getGitChangedFiles(beforeSha, afterSha, rootDir = REPO_ROOT) {
  let diffRange = `${beforeSha}..${afterSha}`;
  if (!beforeSha || /^0+$/.test(beforeSha)) {
    diffRange = `${afterSha}~1..${afterSha}`;
  }

  try {
    const stdout = execSync(`git diff --name-only ${diffRange}`, {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return stdout.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
  } catch (err) {
    try {
      const stdout = execSync(`git show --name-only --format="" ${afterSha}`, {
        cwd: rootDir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return stdout.split(/\r?\n/).map(f => f.trim()).filter(Boolean);
    } catch {
      throw new Error(`Failed to get git diff for range ${diffRange}: ${err.message}`);
    }
  }
}

/**
 * Normalize text content for deterministic hash comparison.
 */
export function normalizeContent(str) {
  return str.replace(/\r\n/g, '\n').trim();
}

/**
 * Compute SHA-256 hash of normalized text or buffer.
 */
export function sha256(input) {
  if (Buffer.isBuffer(input)) {
    return crypto.createHash('sha256').update(input).digest('hex');
  }
  return crypto.createHash('sha256').update(normalizeContent(String(input)), 'utf8').digest('hex');
}

/**
 * Determine if a file path represents a binary file.
 */
function isBinaryFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.eot'].includes(ext);
}

/**
 * Production Readiness Gate:
 * Verifies that all directly changed files (HTML, CSS, JS, Assets, Sitemap)
 * and all affected/added/removed URLs are active and verified in production.
 */
export async function verifyProductionGate({
  changedFiles = [],
  affectedUrls = [],
  addedUrls = [],
  removedUrls = []
} = {}, {
  timeoutMs = 120000,
  pollIntervalMs = 5000,
  rootDir = REPO_ROOT,
  fetchFn = fetch
} = {}) {
  const startTime = Date.now();

  // 1. Build list of verification targets from changedFiles
  const fileTargets = [];

  for (const file of changedFiles) {
    const norm = file.replace(/\\/g, '/').replace(/^\.\//, '');
    // Ignore internal files
    if (
      norm.startsWith('.github/') ||
      norm.startsWith('scripts/') ||
      norm.startsWith('.unlazy/') ||
      norm.startsWith('.git/') ||
      norm.endsWith('.md') ||
      /^[a-f0-9]{32}\.txt$/i.test(norm) ||
      norm === '.gitignore' ||
      norm === 'mini-demo-orcamento.html' ||
      norm === 'landing-pages.html'
    ) {
      continue;
    }

    const localFilePath = path.join(rootDir, norm);
    if (!fs.existsSync(localFilePath)) continue;

    if (norm === 'index.html') {
      fileTargets.push({ type: 'html', path: norm, url: `${CANONICAL_ORIGIN}/`, localFilePath });
    } else if (norm === 'solucoes.html') {
      fileTargets.push({ type: 'html', path: norm, url: `${CANONICAL_ORIGIN}/solucoes`, localFilePath });
    } else if (norm === 'trabalhos.html') {
      fileTargets.push({ type: 'html', path: norm, url: `${CANONICAL_ORIGIN}/trabalhos`, localFilePath });
    } else if (
      norm.endsWith('.css') ||
      norm.endsWith('.js') ||
      norm.endsWith('.xml') ||
      norm.startsWith('assets/') ||
      norm === 'robots.txt'
    ) {
      fileTargets.push({
        type: isBinaryFile(norm) ? 'binary_asset' : 'text_asset',
        path: norm,
        url: `${CANONICAL_ORIGIN}/${norm}`,
        localFilePath
      });
    }
  }

  // 2. Verify all file targets in production
  for (const target of fileTargets) {
    let verified = false;
    let lastError = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetchFn(target.url, {
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });

        if (res.status === 200) {
          if (target.type === 'binary_asset') {
            const localBuf = fs.readFileSync(target.localFilePath);
            const remoteArrayBuf = await res.arrayBuffer();
            const remoteBuf = Buffer.from(remoteArrayBuf);
            const localHash = sha256(localBuf);
            const remoteHash = sha256(remoteBuf);
            if (localHash === remoteHash) {
              verified = true;
              break;
            } else {
              lastError = `Binary hash mismatch for ${target.url} (local: ${localHash.slice(0, 8)}, remote: ${remoteHash.slice(0, 8)})`;
            }
          } else {
            const localText = fs.readFileSync(target.localFilePath, 'utf8');
            const remoteText = await res.text();
            const localHash = sha256(localText);
            const remoteHash = sha256(remoteText);
            if (localHash === remoteHash) {
              verified = true;
              break;
            } else {
              lastError = `Content hash mismatch for ${target.url} (local: ${localHash.slice(0, 8)}, remote: ${remoteHash.slice(0, 8)})`;
            }
          }
        } else {
          lastError = `HTTP ${res.status} for ${target.url}`;
        }
      } catch (err) {
        lastError = err.message;
      }

      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (!verified) {
      throw new Error(`Production gate timed out waiting for changed file ${target.path} (${target.url}): ${lastError || 'Unknown error'}`);
    }
  }

  // 3. Verify added URLs
  for (const addUrl of addedUrls) {
    let verified = false;
    let lastError = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetchFn(addUrl, {
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (res.status === 200) {
          verified = true;
          break;
        } else {
          lastError = `HTTP ${res.status} for added URL ${addUrl}`;
        }
      } catch (err) {
        lastError = err.message;
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (!verified) {
      throw new Error(`Production gate timed out waiting for added URL ${addUrl}: ${lastError || 'Unknown error'}`);
    }
  }

  // 4. Verify removed URLs (prove sitemap in production no longer contains removed URL and/or returns 404/redirect)
  for (const remUrl of removedUrls) {
    let verified = false;
    let lastError = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const sitemapRes = await fetchFn(`${CANONICAL_ORIGIN}/sitemap.xml`, {
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (sitemapRes.status === 200) {
          const sitemapXml = await sitemapRes.text();
          const activeSitemapUrls = parseSitemapUrls(sitemapXml);
          if (!activeSitemapUrls.includes(remUrl)) {
            verified = true;
            break;
          } else {
            lastError = `Production sitemap.xml still contains removed URL ${remUrl}`;
          }
        } else {
          lastError = `HTTP ${sitemapRes.status} fetching production sitemap.xml`;
        }
      } catch (err) {
        lastError = err.message;
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (!verified) {
      throw new Error(`Production gate timed out waiting for removal verification of ${remUrl}: ${lastError || 'Unknown error'}`);
    }
  }

  // 5. Verify any remaining affected URLs respond 200
  for (const affUrl of affectedUrls) {
    if (removedUrls.includes(affUrl)) continue;
    let verified = false;
    let lastError = null;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const res = await fetchFn(affUrl, {
          headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
        });
        if (res.status === 200) {
          verified = true;
          break;
        } else {
          lastError = `HTTP ${res.status} for affected URL ${affUrl}`;
        }
      } catch (err) {
        lastError = err.message;
      }
      await new Promise(r => setTimeout(r, pollIntervalMs));
    }

    if (!verified) {
      throw new Error(`Production gate timed out waiting for affected URL ${affUrl}: ${lastError || 'Unknown error'}`);
    }
  }

  return true;
}

/**
 * Submit URLs to IndexNow API with retry logic.
 */
export async function submitToIndexNow(payload, { fetchFn = fetch, maxRetries = 3, retryDelayMs = 2000 } = {}) {
  const jsonBody = JSON.stringify(payload);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetchFn(INDEXNOW_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: jsonBody
      });
    } catch (err) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelayMs * attempt));
        continue;
      }
      throw new Error(`Network error submitting to IndexNow: ${err.message}`);
    }

    const status = res.status;

    // 200: OK
    if (status === 200) {
      return { status: 200, success: true, message: 'IndexNow submission successful (HTTP 200 OK).' };
    }

    // 202: Accepted (key validation pending)
    if (status === 202) {
      return { status: 202, success: true, warning: true, message: 'IndexNow accepted with key validation pending (HTTP 202 Accepted).' };
    }

    // 429 or 5xx: retryable
    if (status === 429 || (status >= 500 && status <= 599)) {
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, retryDelayMs * attempt));
        continue;
      }
      throw new Error(`IndexNow submission failed with HTTP ${status} after ${maxRetries} attempts.`);
    }

    // 400, 403, 422 or other 4xx: fatal error (zero retries)
    const errText = await res.text().catch(() => '');
    throw new Error(`IndexNow submission rejected with HTTP ${status}: ${errText || 'Fatal client error'}`);
  }
}

/**
 * Main execution handler.
 */
export async function main(args = process.argv.slice(2)) {
  const isDryRun = args.includes('--dry-run');
  const skipGate = args.includes('--skip-gate');
  const beforeArg = args.find(a => a.startsWith('--before='))?.split('=')[1];
  const afterArg = args.find(a => a.startsWith('--after='))?.split('=')[1] || 'HEAD';

  console.log('====================================================');
  console.log(' IDISTØPIC — IndexNow Automation V1');
  console.log('====================================================');
  console.log(`Repository root: ${REPO_ROOT}`);
  console.log(`Dry-run mode:    ${isDryRun ? 'YES' : 'NO'}`);
  console.log(`Skip gate:       ${skipGate ? 'YES' : 'NO'}`);

  // 1. Read IndexNow key
  const keyInfo = getIndexNowKeyInfo(REPO_ROOT);
  console.log(`Key file:        ${keyInfo.keyFile}`);
  console.log(`Key location:    ${keyInfo.keyLocation}`);

  // 2. Read sitemap
  const sitemapPath = path.join(REPO_ROOT, 'sitemap.xml');
  let currentSitemap = '';
  if (fs.existsSync(sitemapPath)) {
    currentSitemap = fs.readFileSync(sitemapPath, 'utf8');
  }

  // 3. Get changed files
  let changedFiles = [];
  let sitemapBefore = '';
  let sitemapAfter = currentSitemap;

  if (beforeArg && afterArg) {
    console.log(`Comparing git diff: ${beforeArg}..${afterArg}`);
    changedFiles = getGitChangedFiles(beforeArg, afterArg, REPO_ROOT);

    if (changedFiles.some(f => f.replace(/\\/g, '/') === 'sitemap.xml')) {
      try {
        sitemapBefore = execSync(`git show ${beforeArg}:sitemap.xml`, {
          cwd: REPO_ROOT,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch {
        sitemapBefore = '';
      }
    }
  } else {
    console.log('No explicit range provided; analyzing HEAD commit.');
    changedFiles = getGitChangedFiles('HEAD~1', 'HEAD', REPO_ROOT);
  }

  console.log(`Changed files (${changedFiles.length}):`);
  changedFiles.forEach(f => console.log(`  - ${f}`));

  // 4. Analyze changes
  const analysis = analyzeChanges(changedFiles, {
    sitemapBefore,
    sitemapAfter,
    currentSitemap
  });

  const { affectedUrls, addedUrls, removedUrls } = analysis;

  console.log(`Affected canonical URLs (${affectedUrls.length}):`);
  affectedUrls.forEach(u => console.log(`  * ${u}`));
  if (addedUrls.length > 0) {
    console.log(`  [Added: ${addedUrls.join(', ')}]`);
  }
  if (removedUrls.length > 0) {
    console.log(`  [Removed: ${removedUrls.join(', ')}]`);
  }

  // 5. Zero case check
  if (affectedUrls.length === 0) {
    console.log('\n[RESULT] INDEXNOW_SKIP_NO_PUBLIC_URL_CHANGES');
    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### IndexNow Automation\n**Status:** SKIP (` + '`INDEXNOW_SKIP_NO_PUBLIC_URL_CHANGES`' + `)\n\nNo public canonical URLs affected in this push.\n`
      );
    }
    return { status: 'SKIP', urls: [] };
  }

  // 6. Build payload
  const payload = {
    host: CANONICAL_HOST,
    key: keyInfo.key,
    keyLocation: keyInfo.keyLocation,
    urlList: affectedUrls
  };

  // 7. Production readiness gate
  if (!skipGate && !isDryRun) {
    console.log('\nWaiting for production deployment gate...');
    await verifyProductionGate({
      changedFiles,
      affectedUrls,
      addedUrls,
      removedUrls
    }, { rootDir: REPO_ROOT });
    console.log('Production gate passed: all affected resources verified in production.');
  }

  // 8. Submit to IndexNow
  if (isDryRun) {
    console.log('\n[DRY RUN] Payload prepared:');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n[RESULT] DRY_RUN_SUCCESS (No HTTP request sent to IndexNow API).');
    return { status: 'DRY_RUN', payload };
  }

  console.log('\nSubmitting to IndexNow API...');
  const result = await submitToIndexNow(payload);
  console.log(`\n[RESULT] ${result.message}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const listMd = affectedUrls.map(u => `- \`${u}\``).join('\n');
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### IndexNow Automation\n**Status:** ${result.status} (${result.message})\n\n**Submitted URLs:**\n${listMd}\n`
    );
  }

  return { status: 'SUCCESS', result, urls: affectedUrls };
}

// Execute if run directly from CLI
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(`\n[ERROR] ${err.message}`);
    process.exit(1);
  });
}
