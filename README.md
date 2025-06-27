# URL Tester with Playwright

An automated URL testing tool that runs on GitHub Actions, tests random URLs for console errors, and checks for element existence on specific pages.

## Features

- 🔄 Tests random URLs from a configurable JSON file
- 🐛 Captures console errors and network failures
- 🎯 Tests for specific element existence on hand-coded URLs
- 📊 Generates HTML and JSON reports
- 🚀 Runs automatically on GitHub Actions
- 📄 Deploys reports to GitHub Pages

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure GitHub Pages:**
   - Go to your repository Settings > Pages
   - Set Source to "GitHub Actions"

3. **Configure URLs and tests:**
   - Edit `urls.json` to add/remove URLs for random testing
   - Edit `config.json` to modify:
     - `randomUrlCount`: Number of random URLs to test each run
     - `elementTests`: Array of element existence tests

## Configuration

### urls.json
Contains an array of URLs that will be randomly selected for testing:
```json
{
  "urls": [
    "https://example.com",
    "https://another-site.com"
  ]
}
```

### config.json
```json
{
  "randomUrlCount": 10,
  "errorWhitelist": {
    "consoleErrors": [
      "CORS",
      "Cross-Origin",
      "blocked by CORS policy",
      "google-analytics",
      "AdBlock"
    ],
    "networkErrors": [
      "favicon.ico",
      "robots.txt",
      "ads",
      "analytics"
    ]
  },
  "elementTests": [
    {
      "url": "https://example.com",
      "selector": ".main-content",
      "description": "Main content area"
    }
  ]
}
```

#### Error Whitelist
The `errorWhitelist` feature allows you to ignore common, non-critical errors:
- **consoleErrors**: Array of strings to match against console error messages
- **networkErrors**: Array of strings to match against failed network request URLs
- Matching is case-insensitive and uses substring matching

## Running Locally

```bash
npm start
```

This will:
1. Select random URLs from `urls.json`
2. Test each URL for console errors and load time
3. Run element existence tests from `config.json`
4. Generate reports in `./reports/` directory

## GitHub Actions

The workflow runs:
- Every 6 hours automatically
- On push to main branch
- Can be triggered manually

Reports are automatically deployed to GitHub Pages at: `https://[username].github.io/[repository-name]/`

## Reports

- **HTML Report**: Visual dashboard with test results (`reports/index.html`)
- **JSON Report**: Raw data for programmatic access (`reports/results.json`)

## Customization

- Modify the user agent in `test-runner.js`
- Adjust timeout values for slow sites
- Add more sophisticated element tests
- Customize the HTML report styling