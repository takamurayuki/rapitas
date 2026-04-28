/**
 * Performance Measurement Script
 *
 * Measures and reports key performance metrics for the Rapitas application.
 * Run with: node scripts/measure-performance.cjs
 *
 * Metrics measured:
 * - Backend API response times (cold start, p50, p95)
 * - Database query performance
 * - Frontend bundle size analysis
 */

const http = require('http');
const https = require('https');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';
const ITERATIONS = 10;

/**
 * Makes an HTTP request and measures response time
 */
function measureRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();
    const protocol = url.startsWith('https') ? https : http;

    const req = protocol.get(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1_000_000;
        resolve({
          statusCode: res.statusCode,
          durationMs,
          dataSize: data.length,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Calculates percentiles from an array of numbers
 */
function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

/**
 * Measures API endpoint performance
 */
async function measureApiPerformance() {
  console.log('\n📊 API Performance Measurement');
  console.log('='.repeat(50));

  const endpoints = [
    { name: 'Health Check', path: '/health' },
    { name: 'Tasks List', path: '/tasks?limit=50' },
    { name: 'Categories', path: '/categories' },
    { name: 'Projects', path: '/projects' },
    { name: 'Settings', path: '/settings' },
  ];

  const results = [];

  for (const endpoint of endpoints) {
    const url = `${BACKEND_URL}${endpoint.path}`;
    const times = [];

    process.stdout.write(`  ${endpoint.name}: `);

    try {
      // Cold start measurement (first request)
      const coldStart = await measureRequest(url);

      // Warm measurements
      for (let i = 0; i < ITERATIONS; i++) {
        const result = await measureRequest(url);
        times.push(result.durationMs);
      }

      const p50 = percentile(times, 50);
      const p95 = percentile(times, 95);
      const avg = times.reduce((a, b) => a + b, 0) / times.length;

      results.push({
        endpoint: endpoint.name,
        coldStart: coldStart.durationMs.toFixed(2),
        p50: p50.toFixed(2),
        p95: p95.toFixed(2),
        avg: avg.toFixed(2),
        status: coldStart.statusCode,
      });

      console.log(
        `✅ cold=${coldStart.durationMs.toFixed(0)}ms p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms`,
      );
    } catch (error) {
      console.log(`❌ ${error.message}`);
      results.push({
        endpoint: endpoint.name,
        error: error.message,
      });
    }
  }

  return results;
}

/**
 * Measures frontend bundle size
 */
function measureBundleSize() {
  console.log('\n📦 Frontend Bundle Analysis');
  console.log('='.repeat(50));

  const frontendDir = path.join(__dirname, '..', 'rapitas-frontend');
  const nextDir = path.join(frontendDir, '.next');

  if (!fs.existsSync(nextDir)) {
    console.log('  ⚠️  .next directory not found. Run `pnpm build` first.');
    return null;
  }

  const staticDir = path.join(nextDir, 'static');
  const results = {
    js: { count: 0, totalSize: 0 },
    css: { count: 0, totalSize: 0 },
  };

  function scanDir(dir) {
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir, { withFileTypes: true });
    for (const file of files) {
      const fullPath = path.join(dir, file.name);
      if (file.isDirectory()) {
        scanDir(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        if (file.name.endsWith('.js')) {
          results.js.count++;
          results.js.totalSize += stats.size;
        } else if (file.name.endsWith('.css')) {
          results.css.count++;
          results.css.totalSize += stats.size;
        }
      }
    }
  }

  scanDir(staticDir);

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  console.log(`  JavaScript: ${results.js.count} files, ${formatSize(results.js.totalSize)}`);
  console.log(`  CSS: ${results.css.count} files, ${formatSize(results.css.totalSize)}`);
  console.log(`  Total: ${formatSize(results.js.totalSize + results.css.totalSize)}`);

  return {
    js: { ...results.js, formatted: formatSize(results.js.totalSize) },
    css: { ...results.css, formatted: formatSize(results.css.totalSize) },
    total: formatSize(results.js.totalSize + results.css.totalSize),
  };
}

/**
 * Checks if backend is running
 */
async function checkBackendHealth() {
  try {
    await measureRequest(`${BACKEND_URL}/health`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates performance report
 */
function generateReport(apiResults, bundleResults) {
  const report = {
    timestamp: new Date().toISOString(),
    backendUrl: BACKEND_URL,
    iterations: ITERATIONS,
    api: apiResults,
    bundle: bundleResults,
  };

  const reportPath = path.join(__dirname, '..', 'performance-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n📄 Report saved to: performance-report.json`);

  return report;
}

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 Rapitas Performance Measurement');
  console.log(`   Backend: ${BACKEND_URL}`);
  console.log(`   Iterations: ${ITERATIONS}`);

  // Check backend availability
  const backendRunning = await checkBackendHealth();

  let apiResults = null;
  if (backendRunning) {
    apiResults = await measureApiPerformance();
  } else {
    console.log('\n⚠️  Backend not running. Skipping API measurements.');
    console.log('   Start the backend with: pnpm dev');
  }

  // Measure bundle size
  const bundleResults = measureBundleSize();

  // Generate report
  generateReport(apiResults, bundleResults);

  // Summary
  console.log('\n📈 Summary');
  console.log('='.repeat(50));

  if (apiResults) {
    const healthyEndpoints = apiResults.filter((r) => !r.error);
    const avgP95 =
      healthyEndpoints.length > 0
        ? healthyEndpoints.reduce((a, b) => a + parseFloat(b.p95), 0) / healthyEndpoints.length
        : 0;

    console.log(`  API Endpoints: ${healthyEndpoints.length}/${apiResults.length} healthy`);
    console.log(`  Avg P95 Latency: ${avgP95.toFixed(0)}ms`);

    // Performance grade
    let grade = 'A';
    if (avgP95 > 100) grade = 'B';
    if (avgP95 > 200) grade = 'C';
    if (avgP95 > 500) grade = 'D';
    if (avgP95 > 1000) grade = 'F';

    console.log(`  Performance Grade: ${grade}`);
  }

  if (bundleResults) {
    const totalKB = (bundleResults.js.totalSize + bundleResults.css.totalSize) / 1024;
    let bundleGrade = 'A';
    if (totalKB > 300) bundleGrade = 'B';
    if (totalKB > 500) bundleGrade = 'C';
    if (totalKB > 1000) bundleGrade = 'D';

    console.log(`  Bundle Size Grade: ${bundleGrade}`);
  }

  console.log('\n✅ Performance measurement complete!');
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
