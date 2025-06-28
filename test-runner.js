const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

function getRandomUrls(urls, count) {
  const shuffled = [...urls].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function isErrorWhitelisted(errorText, whitelist) {
  return whitelist.some(pattern => 
    errorText.toLowerCase().includes(pattern.toLowerCase())
  );
}

async function handleCookieBanner(page) {
  const cookieSelectors = [
    '#onetrust-accept-btn-handler'
  ];

  for (const selector of cookieSelectors) {
    try {
      const element = await page.$(selector);
      if (element && await element.isVisible()) {
        await element.click();
        await page.waitForTimeout(1000); // Wait for any animations
        break;
      }
    } catch (error) {
      // Continue to next selector if this one fails
    }
  }
}

async function testUrl(page, url, errorWhitelist = { consoleErrors: [], networkErrors: [] }) {
  const consoleErrors = [];
  const networkErrors = [];
  const redirects = [];
  const seenConsoleErrors = new Set();
  const seenNetworkErrors = new Set();
  
  // Remove any existing listeners to prevent accumulation
  page.removeAllListeners('console');
  page.removeAllListeners('response');
  page.removeAllListeners('requestfailed');
  
  const consoleHandler = (msg) => {
    if (msg.type() === 'error') {
      const errorText = msg.text();
      if (!isErrorWhitelisted(errorText, errorWhitelist.consoleErrors) && !seenConsoleErrors.has(errorText)) {
        seenConsoleErrors.add(errorText);
        consoleErrors.push({
          text: errorText,
          location: msg.location()
        });
      }
    }
  };
  
  const responseHandler = (response) => {
    const status = response.status();
    const responseUrl = response.url();
    
    // Track redirects (3xx status codes)
    if (status >= 300 && status < 400) {
      redirects.push({
        from: response.request().url(),
        to: responseUrl,
        status: status,
        statusText: response.statusText()
      });
    }
    
    if (!response.ok()) {
      const errorKey = `${status}-${responseUrl}`;
      if (!isErrorWhitelisted(responseUrl, errorWhitelist.networkErrors) && !seenNetworkErrors.has(errorKey)) {
        seenNetworkErrors.add(errorKey);
        networkErrors.push({
          url: responseUrl,
          status: status,
          statusText: response.statusText()
        });
      }
    }
  };

  const requestFailedHandler = (request) => {
    const failedUrl = request.url();
    const failure = request.failure();
    const errorKey = `FAILED-${failedUrl}`;
    if (!isErrorWhitelisted(failedUrl, errorWhitelist.networkErrors) && !seenNetworkErrors.has(errorKey)) {
      seenNetworkErrors.add(errorKey);
      networkErrors.push({
        url: failedUrl,
        status: 'FAILED',
        statusText: failure ? failure.errorText : 'Request failed'
      });
    }
  };
  
  page.on('console', consoleHandler);
  page.on('response', responseHandler);
  page.on('requestfailed', requestFailedHandler);
  
  try {
    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Try to handle cookie banners
    await handleCookieBanner(page);
    
    const loadTime = Date.now() - startTime;
    
    const title = await page.title();
    
    return {
      url,
      success: true,
      title,
      loadTime,
      consoleErrors,
      networkErrors,
      redirects,
      finalUrl: page.url(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      url,
      success: false,
      error: error.message,
      consoleErrors,
      networkErrors,
      redirects,
      finalUrl: url,
      timestamp: new Date().toISOString()
    };
  }
}

async function testElementExists(page, url, selector, description) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
    // Try to handle cookie banners
    await handleCookieBanner(page);
    
    const element = await page.$(selector);
    const exists = element !== null;
    
    let elementInfo = null;
    if (exists) {
      elementInfo = {
        tagName: await element.evaluate(el => el.tagName),
        textContent: (await element.textContent())?.substring(0, 100),
        visible: await element.isVisible()
      };
    }
    
    return {
      url,
      selector,
      description,
      exists,
      elementInfo,
      success: true,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      url,
      selector,
      description,
      exists: false,
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

async function generateHtmlReport(randomUrlResults, elementTestResults) {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URL Testing Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1, h2 { color: #333; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 20px 0; }
        .stat-card { background: #f8f9fa; padding: 15px; border-radius: 6px; text-align: center; }
        .stat-number { font-size: 2em; font-weight: bold; color: #007bff; }
        .stat-label { color: #666; margin-top: 5px; }
        .test-result { margin: 10px 0; padding: 15px; border-radius: 6px; border-left: 4px solid #ddd; }
        .success { border-left-color: #28a745; background: #f8fff9; }
        .error { border-left-color: #dc3545; background: #fff8f8; }
        .url { font-weight: bold; color: #007bff; }
        .error-list { background: #f8f8f8; padding: 10px; border-radius: 4px; margin: 10px 0; }
        .error-item { margin: 5px 0; font-family: monospace; font-size: 0.9em; }
        .timestamp { color: #666; font-size: 0.9em; }
        .load-time { color: #28a745; font-weight: bold; }
        .element-info { background: #e3f2fd; padding: 8px; border-radius: 4px; margin: 5px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h1>URL Testing Report</h1>
        <p class="timestamp">Generated: ${new Date().toLocaleString()}</p>
        
        <div class="summary">
            <div class="stat-card">
                <div class="stat-number">${randomUrlResults.length}</div>
                <div class="stat-label">Random URLs Tested</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${randomUrlResults.filter(r => r.success).length}</div>
                <div class="stat-label">Successful Loads</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${randomUrlResults.reduce((sum, r) => sum + (r.consoleErrors?.length || 0), 0)}</div>
                <div class="stat-label">Console Errors</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${randomUrlResults.reduce((sum, r) => sum + (r.redirects?.length || 0), 0)}</div>
                <div class="stat-label">Redirects</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${elementTestResults.filter(r => r.exists).length}/${elementTestResults.length}</div>
                <div class="stat-label">Elements Found</div>
            </div>
        </div>

        <h2>Random URL Tests</h2>
        ${randomUrlResults.map(result => `
            <div class="test-result ${result.success ? 'success' : 'error'}">
                <div class="url">${result.url}</div>
                ${result.success ? `
                    <div>✅ Loaded successfully in <span class="load-time">${result.loadTime}ms</span></div>
                    <div>Title: ${result.title}</div>
                    ${result.finalUrl !== result.url ? `<div>🔄 Final URL: ${result.finalUrl}</div>` : ''}
                ` : `
                    <div>❌ Failed to load: ${result.error}</div>
                `}
                ${result.redirects && result.redirects.length > 0 ? `
                    <div class="error-list">
                        <strong>Redirects:</strong>
                        ${result.redirects.map(redirect => `
                            <div class="error-item">🔄 ${redirect.status} ${redirect.statusText}: ${redirect.from} → ${redirect.to}</div>
                        `).join('')}
                    </div>
                ` : ''}
                ${result.consoleErrors && result.consoleErrors.length > 0 ? `
                    <div class="error-list">
                        <strong>Console Errors:</strong>
                        ${result.consoleErrors.map(err => `
                            <div class="error-item">🔴 ${err.text}</div>
                        `).join('')}
                    </div>
                ` : ''}
                ${result.networkErrors && result.networkErrors.length > 0 ? `
                    <div class="error-list">
                        <strong>Network Errors:</strong>
                        ${result.networkErrors.map(err => `
                            <div class="error-item">🌐 ${err.status} ${err.statusText} - ${err.url}</div>
                        `).join('')}
                    </div>
                ` : ''}
                <div class="timestamp">${result.timestamp}</div>
            </div>
        `).join('')}

        <h2>Element Existence Tests</h2>
        ${elementTestResults.map(result => `
            <div class="test-result ${result.exists ? 'success' : 'error'}">
                <div class="url">${result.url}</div>
                <div><strong>Test:</strong> ${result.description}</div>
                <div><strong>Selector:</strong> <code>${result.selector}</code></div>
                ${result.exists ? `
                    <div>✅ Element found</div>
                    ${result.elementInfo ? `
                        <div class="element-info">
                            <div><strong>Tag:</strong> ${result.elementInfo.tagName}</div>
                            <div><strong>Visible:</strong> ${result.elementInfo.visible ? 'Yes' : 'No'}</div>
                            ${result.elementInfo.textContent ? `<div><strong>Text:</strong> ${result.elementInfo.textContent}</div>` : ''}
                        </div>
                    ` : ''}
                ` : `
                    <div>❌ Element not found</div>
                    ${result.error ? `<div>Error: ${result.error}</div>` : ''}
                `}
                <div class="timestamp">${result.timestamp}</div>
            </div>
        `).join('')}
    </div>
</body>
</html>`;
  
  return html;
}

async function generateIndexPage() {
  try {
    const files = await fs.readdir('reports');
    const reportFiles = files
      .filter(file => file.startsWith('report-') && file.endsWith('.html'))
      .map(file => {
        const timestampStr = file.replace('report-', '').replace('.html', '');
        const timestamp = new Date(timestampStr.replace(/-/g, ':').replace(/T/, 'T').slice(0, -3) + ':' + timestampStr.slice(-2));
        return {
          filename: file,
          timestamp: timestamp,
          timestampStr: timestampStr,
          displayDate: timestamp.toLocaleString()
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp); // Sort newest first

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>URL Testing Reports - Index</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        h1 { color: #333; text-align: center; margin-bottom: 30px; }
        .report-list { display: grid; gap: 15px; }
        .report-item { 
            background: #f8f9fa; 
            border: 1px solid #dee2e6; 
            border-radius: 6px; 
            padding: 15px; 
            transition: background-color 0.2s;
        }
        .report-item:hover { background: #e9ecef; }
        .report-link { 
            text-decoration: none; 
            color: #007bff; 
            font-weight: bold; 
            font-size: 1.1em;
        }
        .report-link:hover { text-decoration: underline; }
        .report-date { color: #666; margin-top: 5px; }
        .current-report { background: #d4edda; border-color: #c3e6cb; }
        .current-badge { 
            background: #28a745; 
            color: white; 
            padding: 2px 8px; 
            border-radius: 12px; 
            font-size: 0.8em; 
            margin-left: 10px;
        }
        .no-reports { text-align: center; color: #666; padding: 40px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 URL Testing Reports</h1>
        
        ${reportFiles.length > 0 ? `
            <div class="report-list">
                ${reportFiles.map((report, index) => `
                    <div class="report-item ${index === 0 ? 'current-report' : ''}">
                        <a href="${report.filename}" class="report-link">
                            Report - ${report.displayDate}
                            ${index === 0 ? '<span class="current-badge">Latest</span>' : ''}
                        </a>
                        <div class="report-date">Generated: ${report.displayDate}</div>
                    </div>
                `).join('')}
            </div>
        ` : `
            <div class="no-reports">
                <p>No reports found. Run the test suite to generate your first report!</p>
            </div>
        `}
        
        <div style="margin-top: 30px; text-align: center; color: #666; font-size: 0.9em;">
            <p>Reports are automatically generated each time the test suite runs.</p>
        </div>
    </div>
</body>
</html>`;

    return html;
  } catch (error) {
    console.warn('Warning: Could not generate index page:', error.message);
    return `<!DOCTYPE html>
<html><head><title>Reports Index</title></head>
<body><h1>Reports Index</h1><p>Error loading reports list.</p></body></html>`;
  }
}

async function main() {
  try {
    const urlsData = JSON.parse(await fs.readFile('urls.json', 'utf8'));
    const config = JSON.parse(await fs.readFile('config.json', 'utf8'));
    
    const randomUrls = getRandomUrls(urlsData.urls, config.randomUrlCount);
    
    console.log(`Testing ${randomUrls.length} random URLs and ${config.elementTests.length} element tests...`);
    
    const browser = await chromium.launch();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (compatible; URL-Tester/1.0; +https://github.com/your-repo)'
    });
    const page = await context.newPage();
    
    const randomUrlResults = [];
    for (const url of randomUrls) {
      console.log(`Testing: ${url}`);
      const result = await testUrl(page, url, config.errorWhitelist || { consoleErrors: [], networkErrors: [] });
      randomUrlResults.push(result);
    }
    
    const elementTestResults = [];
    for (const test of config.elementTests) {
      console.log(`Testing element: ${test.description} on ${test.url}`);
      const result = await testElementExists(page, test.url, test.selector, test.description);
      elementTestResults.push(result);
    }
    
    await browser.close();
    
    await fs.mkdir('reports', { recursive: true });
    
    const timestamp = new Date();
    const timestampStr = timestamp.toISOString().replace(/[:.]/g, '-').slice(0, -5); // Format: 2024-06-28T12-30-45
    
    const jsonReport = {
      timestamp: timestamp.toISOString(),
      randomUrlResults,
      elementTestResults,
      summary: {
        totalRandomUrls: randomUrlResults.length,
        successfulLoads: randomUrlResults.filter(r => r.success).length,
        totalConsoleErrors: randomUrlResults.reduce((sum, r) => sum + (r.consoleErrors?.length || 0), 0),
        totalRedirects: randomUrlResults.reduce((sum, r) => sum + (r.redirects?.length || 0), 0),
        elementsFound: elementTestResults.filter(r => r.exists).length,
        totalElementTests: elementTestResults.length
      }
    };
    
    // Write timestamped files
    await fs.writeFile(`reports/results-${timestampStr}.json`, JSON.stringify(jsonReport, null, 2));
    
    const htmlReport = await generateHtmlReport(randomUrlResults, elementTestResults);
    await fs.writeFile(`reports/report-${timestampStr}.html`, htmlReport);
    
    // Generate index page listing all reports
    const indexPage = await generateIndexPage();
    await fs.writeFile('reports/index.html', indexPage);
    
    // Also write current files for easy access
    await fs.writeFile('reports/results.json', JSON.stringify(jsonReport, null, 2));
    await fs.writeFile('reports/latest.html', htmlReport);
    
    console.log('✅ Testing complete! Reports generated in ./reports/');
    console.log(`📊 Summary: ${jsonReport.summary.successfulLoads}/${jsonReport.summary.totalRandomUrls} URLs loaded successfully`);
    console.log(`🔍 Elements: ${jsonReport.summary.elementsFound}/${jsonReport.summary.totalElementTests} elements found`);
    console.log(`⚠️  Console errors: ${jsonReport.summary.totalConsoleErrors}`);
    console.log(`🔄 Redirects: ${jsonReport.summary.totalRedirects}`);
    console.log(`📄 Timestamped report: report-${timestampStr}.html`);
    console.log(`📋 Index page: index.html (lists all reports by date)`);
    
  } catch (error) {
    console.error('❌ Error running tests:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getRandomUrls, testUrl, testElementExists, isErrorWhitelisted, handleCookieBanner };