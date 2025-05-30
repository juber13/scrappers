import { chromium } from "playwright";
import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { Solver } from "2captcha";

dotenv.config();

// Validate 2captcha API key
const TWO_CAPTCHA_API_KEY = process.env.TWO_CAPTCHA_API_KEY;
if (!TWO_CAPTCHA_API_KEY) {
  console.error("Error: TWO_CAPTCHA_API_KEY is not set in environment variables");
  process.exit(1);
}

const app = express();
app.use(express.json());

const OUTPUT_DIR = "quora_data";
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function extractCaptchaInfo(page) {
  try {
    // Wait for the reCAPTCHA iframe to be present
    await page.waitForSelector('iframe[title="reCAPTCHA"]', { timeout: 10000 });
    
    // Extract sitekey from the iframe src
    const sitekey = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[title="reCAPTCHA"]');
      if (!iframe) return null;
      const src = iframe.src;
      const match = src.match(/k=([^&]+)/);
      return match ? match[1] : null;
    });

    if (!sitekey) {
      throw new Error("Could not extract reCAPTCHA sitekey");
    }

    console.log("Extracted sitekey:", sitekey);
    return {
      sitekey,
      url: page.url()
    };
  } catch (error) {
    console.error("Error extracting CAPTCHA info:", error);
    return null;
  }
}

async function solveCaptchaWith2Captcha(captchaInfo) {
  try {
    console.log("Initializing 2captcha solver...");
    const solver = new Solver(TWO_CAPTCHA_API_KEY);
    
    console.log("Submitting CAPTCHA to 2captcha with sitekey:", captchaInfo.sitekey);
    
    // Ensure sitekey is a string and not empty
    if (!captchaInfo.sitekey || typeof captchaInfo.sitekey !== 'string') {
      throw new Error('Invalid sitekey: must be a non-empty string');
    }

    // Create a promise that will resolve with the solution
    return new Promise((resolve, reject) => {
      solver.recaptcha(
        captchaInfo.sitekey.toString(), // Ensure sitekey is a string
        captchaInfo.url,
        {
          proxy: {
            type: 'HTTP',
            uri: process.env.PROXY_URI // Optional: Add proxy if needed
          }
        }
      )
      .then(result => {
        console.log("CAPTCHA solution received");
        resolve(result.data);
      })
      .catch(error => {
        console.error("Error from 2captcha:", error);
        reject(error);
      });
    });
  } catch (error) {
    console.error("Error solving CAPTCHA:", error);
    throw error;
  }
}

async function applyCaptchaSolution(page, token) {
  try {
    console.log("Applying CAPTCHA solution...");
    
    // Inject the token into the page
    await page.evaluate((token) => {
      // Create or find the response element
      let responseElement = document.getElementById("g-recaptcha-response");
      if (!responseElement) {
        responseElement = document.createElement("textarea");
        responseElement.id = "g-recaptcha-response";
        responseElement.name = "g-recaptcha-response";
        responseElement.style.display = "none";
        document.body.appendChild(responseElement);
      }
      responseElement.value = token;

      // Try to trigger the callback
      if (window.___grecaptcha_cfg) {
        const callback = window.___grecaptcha_cfg.clients[0].callback;
        if (typeof callback === 'function') {
          callback(token);
        }
      }
    }, token);

    // Wait for the form to be enabled
    await page.waitForFunction(() => {
      const form = document.querySelector('form');
      return form && !form.hasAttribute('disabled');
    }, { timeout: 5000 });

    // Wait for the login button to be enabled
    console.log("Waiting for login button to be enabled...");
    await page.waitForSelector("button:not([disabled])", { timeout: 10000 });

    // Get the login button and click it
    const loginBtn = await page.$("button:not([disabled])");
    console.log("Login button found:", loginBtn ? "Yes" : "No");

    if (loginBtn) {
      console.log("Clicking login button...");
      await loginBtn.click();
      
      // Wait for navigation
      await page.waitForNavigation({ timeout: 30000 });
      console.log("Navigation completed after login");
    } else {
      console.log("❌ Login button not found or not clickable");
      throw new Error("Login button not found or not clickable");
    }

  } catch (error) {
    console.error("Error applying CAPTCHA solution:", error);
    throw error;
  }
}

const quoraScraper = async (searchQuery, maxAnswers = 50) => {
  const browser = await chromium.launch({
    headless: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--ignore-certificate-errors",
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Navigate to login page
    await page.goto("https://www.quora.com/login");
    
    // Fill in credentials using type() instead of fill()
    await page.type("input[name='email']", process.env.QUORA_USERNAME);
    await page.type("input[name='password']", process.env.QUORA_PASSWORD);

    // Extract CAPTCHA info and solve if needed
    const captchaInfo = await extractCaptchaInfo(page);
    if (captchaInfo) {
      console.log("CAPTCHA detected, solving...");
      const token = await solveCaptchaWith2Captcha(captchaInfo);
      await applyCaptchaSolution(page, token);
    }

    // Continue with the rest of your scraping logic...
    console.log(`Searching Quora for: "${searchQuery}"`);
    // ... rest of your existing scraping code ...

  } catch (error) {
    console.error("Error:", error);
    return null;
  } finally {
    await browser.close();
  }
};

// Start the scraper
quoraScraper("cybersecurity");
