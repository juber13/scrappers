// import puppeteer from 'puppeteer';
import { chromium } from 'playwright';
import { Solver } from '2captcha';
import dotenv from 'dotenv';
import { setTimeout } from 'timers/promises';
import scrapeQuoraSearch from './test1.js';

// Load environment variables
dotenv.config();

const solver = new Solver(process.env.TWO_CAPTCHA_API_KEY);
const pageUrl = 'https://www.quora.com/';

async function waitForRecaptchaLoad(page) {
  try {
    await page.waitForFunction(() => {
      return typeof window.___grecaptcha_cfg !== 'undefined' && 
           Object.keys(window.___grecaptcha_cfg.clients).length > 0;
    }, { timeout: 60000 });
    return true;
  } catch (error) {
    console.error('Timeout waiting for reCAPTCHA to initialize');
    return false;
  }
}

async function findRecaptchaClients(page) {
  return page.evaluate(() => {
    if (typeof window.___grecaptcha_cfg !== "undefined") {
      return Object.entries(___grecaptcha_cfg.clients).map(([cid, client]) => {
        const data = { id: cid, version: cid >= 10000 ? "V3" : "V2" };
        const objects = Object.entries(client).filter(
          ([_, value]) => value && typeof value === "object"
        );

        objects.forEach(([toplevelKey, toplevel]) => {
          const found = Object.entries(toplevel).find(
            ([_, value]) =>
              value &&
              typeof value === "object" &&
              "sitekey" in value &&
              "size" in value
          );

          if (
            typeof toplevel === "object" &&
            toplevel instanceof HTMLElement &&
            toplevel.tagName === "DIV"
          ) {
            data.pageurl = toplevel.baseURI;
          }

          if (found) {
            const [sublevelKey, sublevel] = found;
            data.sitekey = sublevel.sitekey;

            const callbackKey =
              data.version === "V2" ? "callback" : "promise-callback";
            const callback = sublevel[callbackKey];

            if (!callback) {
              data.callback = null;
              data.function = null;
            } else {
              data.function = callback;
              const keys = [cid, toplevelKey, sublevelKey, callbackKey]
                .map((k) => `['${k}']`)
                .join("");
              data.callback = `___grecaptcha_cfg.clients${keys}`;
            }
          }
        });

        return data;
      });
    }

    return [];
  });

}

async function solveCaptcha(page) {
  // Get all reCAPTCHA clients from the page
  const clients = await findRecaptchaClients(page);
  
  if (clients.length === 0) {
    console.error('No reCAPTCHA clients found on the page');
    return false;
  }

  // Use the first V2 captcha found
  const captcha = clients.find(client => client.version === 'V2');
  
  if (!captcha) {
    console.error('No V2 reCAPTCHA found on the page');
    return false;
  }

  console.log('Found reCAPTCHA:', {
    version: captcha.version,
    sitekey: captcha.sitekey,
    hasCallback: !!captcha.callback
  });

  try {
    const result = await solver.recaptcha(
      captcha.sitekey,
      pageUrl,
    );

    console.log('Captcha solved:', result.id);

    // Insert the solution and execute callback if available
    await page.evaluate(({ token, callback }) => {
      // Set the response in textarea
      document.querySelector('textarea[name="g-recaptcha-response"]').value = token;
      
      // Execute callback if available
      if (callback) {
        const callbackFn = new Function(`return ${callback}`)();
        if (typeof callbackFn === 'function') {
          console.log('Executing reCAPTCHA callback');
          callbackFn(token);
        }
      }
    }, { 
      token: result.data, 
      callback: captcha.callback 
    });

    return true;
  } catch (error) {
    console.error('Failed to solve captcha:', error);
    return false;
  }
}

async function main() {
  try {
    const browser = await chromium.launch({headless: true,});

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
      javaScriptEnabled: true,
      bypassCSP: true,
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    const page = await context.newPage();

    // Navigate to login page
    const loginUrl = "https://www.quora.com/login";
    console.log("Navigating to login page...");
    await page.goto(loginUrl, { waitUntil: "networkidle" });

    // Wait for login fields
    await page.waitForSelector('input[name="email"]', {timeout : 10000});
    await page.fill('input[name="email"]', process.env.QUORA_USERNAME);
    await page.fill('input[name="password"]', process.env.QUORA_PASSWORD);
    await page.waitForTimeout(3000);

  

    // Wait for reCAPTCHA to initialize
    const recaptchaLoaded = await waitForRecaptchaLoad(page);
    if (!recaptchaLoaded) {
      throw new Error("reCAPTCHA failed to initialize");
    }
    console.log("reCAPTCHA initialized");

    // Solve reCAPTCHA
    const success = await solveCaptcha(page);
    if (success) {
      console.log("Captcha solved successfully!");
      // Dispatch input/change events and submit the form manually
    // Wait until the Login button is enabled
  await page.waitForSelector('button:has-text("Login"):not([disabled])', { timeout: 10000 });
  // Click the enabled Login button
  await page.click('button:has-text("Login"):not([disabled])');
  // scrapeQuoraSearch(page , "cybersecurity course in delhi");
    
  }
  } catch (error) {
    page.close();
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

// Run the bot
main(); 