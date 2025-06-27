const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

function getRandomUrls(urls, count) {
  const shuffled = [...urls].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

function isErrorWhitelisted(errorText, ) {
  return whitelist.some(pattern => 
    errorText.toLowerCase().includes(pattern.toLowerCase())
  );
}

async function testUrl(page, url, errorWhitelist = { consoleErrors: [], networkErrors: [] }) {
  const consoleErrors = [];
  const networkErrors = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const errorText = msg.text();
      if (!isErrorWhitelisted(errorText, errorWhitelist.consoleErrors)) {
        consoleErrors.push({
          text: errorText,
          location: msg.location()
        });
      }
    }
  });
  
  page.on('response', response => {
    if (!response.ok()) {
      const responseUrl = response.url();
      if (!isErrorWhitelisted(responseUrl, errorWhitelist.networkErrors)) {
        networkErrors.push({
          url: responseUrl,
          status: response.status(),
          statusText: response.statusText()
        });
      }
    }
  });
  
  try {
    const startTime = Date.now();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const loadTime = Date.now() - startTime;
    
    const title = await page.title();
    
    return {
      url,
      success: true,
      title,
      loadTime,
      consoleErrors,
      networkErrors,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      url,
      success: false,
      error: error.message,
      consoleErrors,
      networkErrors,
      timestamp: new Date().toISOString()
    };
  }
}

async function testElementExists(page, url, selector, description) {
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    
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
                ` : `
                    <div>❌ Failed to load: ${result.error}</div>
                `}
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
    
    const jsonReport = {
      timestamp: new Date().toISOString(),
      randomUrlResults,
      elementTestResults,
      summary: {
        totalRandomUrls: randomUrlResults.length,
        successfulLoads: randomUrlResults.filter(r => r.success).length,
        totalConsoleErrors: randomUrlResults.reduce((sum, r) => sum + (r.consoleErrors?.length || 0), 0),
        elementsFound: elementTestResults.filter(r => r.exists).length,
        totalElementTests: elementTestResults.length
      }
    };
    
    await fs.writeFile('reports/results.json', JSON.stringify(jsonReport, null, 2));
    
    const htmlReport = await generateHtmlReport(randomUrlResults, elementTestResults);
    await fs.writeFile('reports/index.html', htmlReport);
    
    console.log('✅ Testing complete! Reports generated in ./reports/');
    console.log(`📊 Summary: ${jsonReport.summary.successfulLoads}/${jsonReport.summary.totalRandomUrls} URLs loaded successfully`);
    console.log(`🔍 Elements: ${jsonReport.summary.elementsFound}/${jsonReport.summary.totalElementTests} elements found`);
    console.log(`⚠️  Console errors: ${jsonReport.summary.totalConsoleErrors}`);
    
  } catch (error) {
    console.error('❌ Error running tests:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getRandomUrls, testUrl, testElementExists, isErrorWhitelisted };