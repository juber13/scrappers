import { Solver } from "2captcha";
import { chromium } from "playwright";

import dotenv from "dotenv";
import { setTimeout } from "timers/promises";
// Load environment variables

dotenv.config();

const solver = new Solver(process.env.TWO_CAPTCHA_API_KEY);
const pageUrl = "https://quora.com";

async function waitForRecaptchaLoad(page) {
  try {
    await page.waitForFunction(
      () => {
        return (
          typeof window.___grecaptcha_cfg !== "undefined" &&
          Object.keys(window.___grecaptcha_cfg.clients).length > 0
        );
      },
      { timeout: 60000 }
    );
    return true;
  } catch (error) {
    console.error("Timeout waiting for reCAPTCHA to initialize");
    return false;
  }
}

async function findRecaptchaClients(page) {
  return page.evaluate(`function findRecaptchaClients() {
		if (typeof (___grecaptcha_cfg) !== 'undefined') {
			return Object.entries(___grecaptcha_cfg.clients).map(([cid, client]) => {
				const data = { id: cid, version: cid >= 10000 ? 'V3' : 'V2' };
				const objects = Object.entries(client).filter(([_, value]) => value && typeof value === 'object');

				objects.forEach(([toplevelKey, toplevel]) => {
					const found = Object.entries(toplevel).find(([_, value]) => (
						value && typeof value === 'object' && 'sitekey' in value && 'size' in value
					));

					if (typeof toplevel === 'object' && toplevel instanceof HTMLElement && toplevel['tagName'] === 'DIV') {
						data.pageurl = toplevel.baseURI;
					}

					if (found) {
						const [sublevelKey, sublevel] = found;

						data.sitekey = sublevel.sitekey;
						const callbackKey = data.version === 'V2' ? 'callback' : 'promise-callback';
						const callback = sublevel[callbackKey];
						if (!callback) {
							data.callback = null;
							data.function = null;
						} else {
							data.function = callback;
							const keys = [cid, toplevelKey, sublevelKey, callbackKey].map((key) => \`['\${key}']\`).join('');
							data.callback = \`___grecaptcha_cfg.clients\${keys}\`;
						}
					}
				});
				return data;
			});
		}
		return [];
	}
	
	findRecaptchaClients()`);
}

async function solveCaptcha(page) {
  // Get all reCAPTCHA clients from the page
  const clients = await findRecaptchaClients(page);

  if (clients.length === 0) {
    console.error("No reCAPTCHA clients found on the page");
    return false;
  }

  // Use the first V2 captcha found
  const captcha = clients.find((client) => client.version === "V2");

  if (!captcha) {
    console.error("No V2 reCAPTCHA found on the page");
    return false;
  }

  console.log("Found reCAPTCHA:", {
    version: captcha.version,
    sitekey: captcha.sitekey,
    hasCallback: !!captcha.callback,
  });

  try {
    const result = await solver.recaptcha(captcha.sitekey, pageUrl);

    console.log("Captcha solved:", result.id);
    // Insert the solution and execute callback if available
    await page.evaluate(
      ({ token, callback }) => {
        // Set the response in textarea
        document.querySelector('textarea[name="g-recaptcha-response"]').value =
          token;

        // Execute callback if available
        if (callback) {
          const callbackFn = new Function(`return ${callback}`)();
          if (typeof callbackFn === "function") {
            console.log("Executing reCAPTCHA callback");
            callbackFn(token);
          }
        }
      },
      {
        token: result.data,
        callback: captcha.callback,
      }
    );

    return true;
  } catch (error) {
    console.error("Failed to solve captcha:", error);
    return false;
  }
}



async function main() {
  try {
    // Launch browser
    const browser = await chromium.launch({
      headless: false,
    });
    const page = await browser.newPage();
    console.log("Navigating to 2Captcha demo page...");

    await page.goto(pageUrl, { waitUntil: "networkidle" });
    await page.waitForSelector('input[name="email"]');
    await page.fill('input[name="email"]', process.env.QUORA_USERNAME);
    await page.fill('input[name="password"]', process.env.QUORA_PASSWORD);
    await page.waitForTimeout(3000);


    // Wait for reCAPTCHA to load
    // const recaptchaFrame = await page.waitForSelector('iframe[src*="recaptcha"]');
    const captchaCheckbox = await page.$('iframe[title="reCAPTCHA"]');

    if (!captchaCheckbox) {
      throw new Error("reCAPTCHA failed to initialize");
    }
    
    console.log("reCAPTCHA initialized");

    // Solve reCAPTCHA
    const captchaSolution = await solver.recaptcha({
      pageurl: page.url(),
      googlekey: process.env.GOOGLE_API_KEY,
    });

    // Insert solution into the captcha response field
    await page.fill("#g-recaptcha-response", captchaSolution);
    console.log("Captcha solved successfully!");

    await page.waitForTimeout(1000);

    // Submit the form
    await page.click('text="Check"');
    console.log("Form submitted");

    await page.waitForTimeout(15000);

    // Close browser
    // await browser.close();
  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

main();

