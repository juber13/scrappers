import { chromium } from "playwright";
import dotenv from "dotenv";
import { Solver } from "2captcha";

dotenv.config();

const API_KEY = process.env.TWO_CAPTCHA_API_KEY;
const solver = new Solver(API_KEY);

const url = "https://www.quora.com";
const sitekey = "6Lcbz34UAAAAAL8AdJSo8BkXQ-pUMfr7OfbTZCY8";

// async function solveCaptcha() {
//   console.log("🔍 Solving reCAPTCHA...");
//   const result = await solver.recaptcha({ sitekey, url });
//   console.log("✅ Captcha Solved");
//   return result.code;
// }

async function solveCaptcha(page, url) {
  console.log("🔍 Extracting sitekey...");
  const sitekey = await page.$eval("iframe[title=reCAPTCHA]", (el) =>
    el.getAttribute("data-sitekey")
  );

  if (!sitekey || sitekey.length < 30) {
    throw new Error("Sitekey not found or invalid on the page.");
  }

  console.log("🔑 Sitekey:", sitekey);
  console.log("🔍 Solving reCAPTCHA via 2Captcha...");
  const result = await solver.recaptcha({ sitekey, url });
  console.log("✅ Captcha Solved");
  return result.code;
}


async function run() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    console.log(`🔗 Navigating to ${url}...`);
    await page.goto(url, { waitUntil: "load", timeout: 60000 });

    // Solve the reCAPTCHA with 2Captcha
    const token = await solveCaptcha(page , url);

    // Inject the CAPTCHA token into the page
    await page.evaluate((captchaToken) => {
      let textarea = document.querySelector("#g-recaptcha-response");
      if (!textarea) {
        textarea = document.createElement("textarea");
        textarea.id = "g-recaptcha-response";
        textarea.name = "g-recaptcha-response";
        textarea.style.display = "none";
        document.body.appendChild(textarea);
      }
      textarea.value = captchaToken;

      const form = document.querySelector("form");
      if (form) {
        let hiddenInput = form.querySelector(
          'input[name="g-recaptcha-response"]'
        );
        if (!hiddenInput) {
          hiddenInput = document.createElement("input");
          hiddenInput.type = "hidden";
          hiddenInput.name = "g-recaptcha-response";
          hiddenInput.value = captchaToken;
          form.appendChild(hiddenInput);
        } else {
          hiddenInput.value = captchaToken;
        }
      }
    }, token);

    // Submit the form
    console.log("🚀 Submitting the form...");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 60000 }),
      page.click('button[type="submit"], input[type="submit"]'),
    ]);

    // Extract final result
    const result = await page.textContent("td:last-child");
    console.log("📦 Extracted Data:", result.trim());
  } catch (err) {
    console.error("❌ Error:", err.message);
  } finally {
    await browser.close();
  }
}

run();
