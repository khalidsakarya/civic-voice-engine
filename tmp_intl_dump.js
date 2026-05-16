'use strict';
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const TARGETS = [
  { id: 'AU-ACT-parl', url: 'https://www.parliament.act.gov.au/members' },
  { id: 'AU-NT-parl', url: 'https://parliament.nt.gov.au/members' },
];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  for (const { id, url } of TARGETS) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    try {
      const res = await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise(r => setTimeout(r, 4000));
      const text = await page.evaluate(() => document.body ? document.body.innerText : '');
      const title = await page.title();
      console.log('\n=== ' + id + ' HTTP=' + res.status() + ' len=' + text.length + ' title="' + title + '" ===');
      console.log(text.slice(0, 2000));
    } catch (e) {
      console.log('\n=== ' + id + ' ERR: ' + e.message.slice(0, 100) + ' ===');
    }
    await page.close();
  }
  await browser.close();
})();
