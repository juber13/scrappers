import { chromium } from "playwright";
import axios from "axios";
import dotenv from "dotenv";
import fs from "fs";
import FormData from "form-data";
import sharp from "sharp"; // Required for image compression

dotenv.config();

const apiKey = process.env.TWO_CAPTCHA_API_KEY;

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto("https://www.quora.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForSelector('input[name="email"]');
  await page.fill('input[name="email"]', process.env.QUORA_USERNAME);
  await page.fill('input[name="password"]', process.env.QUORA_PASSWORD);
  await page.waitForTimeout(3000);

  // Click CAPTCHA checkbox to trigger challenge popup
  const captchaCheckbox = await page.$('iframe[title="reCAPTCHA"]');
  if (!captchaCheckbox) {
    console.log("❌ No reCAPTCHA iframe found.");
    await browser.close();
    return;
  }

  await captchaCheckbox.click();
  await page.waitForTimeout(2000);

  // Wait for reCAPTCHA challenge iframe
  const challengeFrame = page.frameLocator('iframe[src*="bframe"]');

  // **Loop through "Skip" clicks until "Verify" appears**
  let skipCount = 0;
  while (
    await challengeFrame
      .locator('#recaptcha-verify-button:has-text("Skip")')
      .isVisible()
  ) {
    console.log(`⏭️ Clicking "Skip" button (${skipCount + 1})`);
    await challengeFrame
      .locator('#recaptcha-verify-button:has-text("Skip")')
      .click();
    await page.waitForTimeout(2000);
    skipCount++;
  }

  // Capture and Compress CAPTCHA image
  const imagePath = "captcha_compressed.jpg";
  await page.screenshot({
    path: "captcha.png",
    clip: { x: 50, y: 200, width: 300, height: 200 },
  });

  await sharp("captcha.png")
    .resize(300, 200)
    .jpeg({ quality: 90 })
    .toFile(imagePath);
  const imageBuffer = fs.readFileSync(imagePath);

  // Create FormData correctly
  const formData = new FormData();
  formData.append("key", apiKey);
  formData.append("method", "post");
  formData.append("file", imageBuffer, { filename: "captcha.jpg" });
  formData.append("coordinatescaptcha", "1"); // Enables image selection solving
  formData.append("json", "1");

  // Send request with proper headers
  let requestId;
  for (let attempt = 0; attempt < 3; attempt++) {
      const captchaSubmit = await axios.post("http://2captcha.com/in.php",formData,{headers: formData.getHeaders(),}
    );

    if (captchaSubmit.data.status === 1) {
      requestId = captchaSubmit.data.request;
      console.log("🧠 CAPTCHA submitted. Request ID:", requestId);
      break;
    } else {
      console.log(
        `⚠️ CAPTCHA submission attempt ${attempt + 1} failed: ${captchaSubmit.data.request
        }`
      );
      await new Promise((res) => setTimeout(res, 5000));
    }
  }

  if (!requestId) {
    throw new Error("❌ CAPTCHA submission failed after multiple attempts.");
  }

  // Fetch CAPTCHA solution
  let solution;
  for (let i = 0; i < 20; i++) {
    // Increased retries
    await new Promise((res) => setTimeout(res, 7000)); // Increased wait time
    const result = await axios.get("http://2captcha.com/res.php", {
      params: { key: apiKey, action: "get", id: requestId, json: 1 },
    });

    if (result.data.status === 1) {
      solution = result.data.request;
      console.log("✅ CAPTCHA Solved:", solution);
      break;
    } else if (result.data.request === "ERROR_CAPTCHA_UNSOLVABLE") {
      console.log("⚠️ CAPTCHA is marked as unsolvable, retrying...");
      await page.screenshot({ path: "captcha_retry.png", fullPage: true });
      await sharp("captcha_retry.png")
        .jpeg({ quality: 85 })
        .toFile("captcha_retry_compressed.jpg");
      // Restart CAPTCHA submission...
    } else {
      console.log(`⏳ Waiting for CAPTCHA solution (${i + 1}/20)`);
    }
  }

  if (!solution) {
    throw new Error("❌ CAPTCHA could not be solved.");
  }

  // **Inject CAPTCHA token BEFORE clicking Verify**
  await page.evaluate((solution) => {
    let textarea = document.getElementById("g-recaptcha-response");
    if (!textarea) {
      textarea = document.createElement("textarea");
      textarea.id = "g-recaptcha-response";
      textarea.name = "g-recaptcha-response";
      textarea.style.display = "block";
      document.body.appendChild(textarea);
    }
    textarea.value = solution;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }, solution);

  // Wait for CAPTCHA verification
  await page.waitForTimeout(3000);

  // **Simulate User Interaction to Validate Image Selection CAPTCHA**
  await page.evaluate(() => {
    let recaptchaArea = document.querySelector("#rc-imageselect");
    if (recaptchaArea) {
      recaptchaArea.dispatchEvent(new Event("mouseover", { bubbles: true }));
      recaptchaArea.dispatchEvent(new Event("click", { bubbles: true }));
    }
  });

  // **Check if CAPTCHA is still asking for image selection**
  if (
    await challengeFrame
      .locator('text="Please select all matching images"')
      .isVisible()
  ) {
    console.log("⚠️ CAPTCHA still active, waiting...");
    await page.waitForTimeout(5000);
  }

  // **Ensure Verify button appears before clicking**
  await challengeFrame
    .locator("#recaptcha-verify-button:has-text('Verify')")
    .waitFor({ state: "visible", timeout: 30000 });
  await challengeFrame
    .locator("#recaptcha-verify-button:has-text('Verify')")
    .click();
  console.log("✅ Clicked Verify button successfully!");

  // Click login button
  const loginBtn = await page.$("button:not([disabled])");
  if (loginBtn) {
    await loginBtn.click();
  } else {
    console.log("❌ Login button not found.");
  }

  // Wait for navigation
  try {
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 });
    console.log("✅ Logged in and navigated to Quora home.");
  } catch (err) {
    console.log("⚠️ Navigation after login did not complete in time.");
  }

  await page.waitForTimeout(5000);
  await browser.close();
})();
