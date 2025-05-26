import { chromium } from "playwright";
import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("https://www.quora.com/login");

  await page.waitForSelector('input[name="email"]');
  await page.fill('input[name="email"]', process.env.QUORA_USERNAME);
  await page.fill('input[name="password"]', process.env.QUORA_PASSWORD);

  await page.waitForSelector('iframe[title="reCAPTCHA"]', { timeout: 10000 });



  // Extract site key
  const siteKey = await page.evaluate(() => {
    const iframe = document.querySelector('iframe[title="reCAPTCHA"]');
    return iframe ? new URL(iframe.src).searchParams.get("k") : null;
  });

  async function extractCaptchaInfo() {
    await page.goto("https://www.quora.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    if (page.url().includes("/sorry/")) {
      const html = await page.content();

      const sitekeyMatch = html.match(/data-sitekey="([^"]+)"/);
      const dataSMatch = html.match(/data-s="([^"]+)"/);

      if (!sitekeyMatch || !dataSMatch) {
        throw new Error("Failed to extract sitekey or data-s");
      }

      return {
        sitekey: sitekeyMatch[1],
        dataS: dataSMatch[1],
        url: page.url(),
      };
    }

    console.log("No CAPTCHA found.");
    return null;
  }


  async function solveCaptchaWith2Captcha({ sitekey, dataS, url }) {
      const res = await axios.get("http://2captcha.com/in.php", {
        params: {
          key: apiKey,
          method: "userrecaptcha",
          googlekey: sitekey,
          pageurl: url,
          datas: 'base64:',
          json: 1,
        },
      });
  
      if (res.data.status === 1) {
        return res.data.request;
      } else {
        throw new Error("Failed to submit CAPTCHA: " + res.data.error_text);
      }
    }

    
      async function pollForToken(requestId) {
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 5000));
    
          const result = await axios.get("http://2captcha.com/res.php", {
            params: {
              key: apiKey,
              action: "get",
              id: requestId,
              json: 1,
            },
          });
    
          if (result.data.status === 1) {
            return result.data.request;
          } else if (result.data.request !== "CAPCHA_NOT_READY") {
            throw new Error("CAPTCHA Error: " + result.data.request);
          }
        }
        throw new Error("Timed out waiting for CAPTCHA solution");
      }
    
      const captchaInfo = await extractCaptchaInfo();
      if (captchaInfo) {
        const requestId = await solveCaptchaWith2Captcha(captchaInfo);
        const token = await pollForToken(requestId);
    
        const captchaResponseInput = await page.$("#g-recaptcha-response");
        if (captchaResponseInput) {
          await page.evaluate((token) => {
            const textarea = document.querySelector("#g-recaptcha-response");
            if (textarea) textarea.style.display = "block";
          }, token);
          await captchaResponseInput.fill(token);
        }
    
        await page.evaluate(() => {
          const form = document.querySelector("#captcha-form");
          if (form) form.submit();
        });
      }
    


  const captchaId = captchaResponse.data.request;

 

  // Inject CAPTCHA token
  await page.evaluate((token) => {
    let textarea = document.querySelector("#g-recaptcha-response");
    if (!textarea) {
      textarea = document.createElement("textarea");
      textarea.id = "g-recaptcha-response";
      textarea.name = "g-recaptcha-response";
      textarea.style.display = "none";
      document.body.appendChild(textarea);
    }
    textarea.value = token;

    // Add a hidden input if required
    const form = document.querySelector("form");
    if (form && !form.querySelector('input[name="g-recaptcha-response"]')) {
      const hiddenInput = document.createElement("input");
      hiddenInput.type = "hidden";
      hiddenInput.name = "g-recaptcha-response";
      hiddenInput.value = token;
      form.appendChild(hiddenInput);
      console.log("token injected");
    }

    // Trigger the reCAPTCHA callback
    if (window.___grecaptcha_cfg) {
      const callback = window.___grecaptcha_cfg.clients[0].callback;
      if (typeof callback === 'function') {
        callback(token);
      }
    }
  }, captchaToken);


  // Click the login button
  console.log("Clicking login button...");
  
})();
