

import { chromium } from "playwright";
import axios from "axios";
import dotenv from "dotenv";
import fs from 'fs'
dotenv.config();

const apiKey = process.env.TWO_CAPTCHA_API_KEY;
const dataDir = "./data";

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  async function extractCaptchaInfo() {
    await page.goto(
      "https://www.google.com/search?q=cyber+security+jobs+in+delhi",
      {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      }
    );

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
        datas: dataS,
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

  await page.waitForLoadState("networkidle");
  await page.locator('div.ZFiwCf:has-text("more jobs")').click();
  await page.waitForLoadState("networkidle");

  async function scrollToBottom(page) {
    let previousHeight = await page.evaluate(() => document.body.scrollHeight);
    while (true) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(Math.random() * 2000);
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === previousHeight) break;
      previousHeight = newHeight;
    }
  }

  await scrollToBottom(page);

  const jobList = page.locator('#search div[jscontroller="b11o3b"]');
  await page.waitForTimeout(1000);
  const jobCount = await jobList.count();
  if (jobCount === 0) {
    console.log("No more jobs found");
    return;
  }

  for (let i = 0; i < jobCount; i++) {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 1500));
    const job = jobList.nth(i).locator("div > div > div > div > a").nth(0);
    const jobUrl = await job.getAttribute("href");

    const titleBlock = jobList
      .nth(i)
      .locator("span")
      .nth(1)
      .locator("div")
      .nth(0)
      .locator("div div");
    const title = await titleBlock.nth(0).innerText();
    const company = await titleBlock.nth(1).innerText();
    const location = await titleBlock.nth(2).innerText();

    const salaryBlock = job.locator("span .ApHyTb").locator("div.K3eUK");

    async function extractDynamicJobFields(el) {
      const jobDetails = {};
      const spans = await el.locator(".Yf9oye").elementHandles();
      for (const span of spans) {
        const ariaLabel = await span.getAttribute("aria-label");
        const innerText = await span.innerText();
        if (ariaLabel) {
          let key = ariaLabel.split(":")[0].trim();
          if (key.includes("Salary")) key = "salary";
          else if (key.includes("Posted")) key = "posted";
          else if (key.includes("Employment type")) key = "employmentType";
          jobDetails[key] = innerText.trim();
        }
      }
      return jobDetails;
    }

    const dynamicJobFields = await extractDynamicJobFields(salaryBlock);

    await jobList.nth(i).click();
    await page.waitForSelector("#Sva75c", { state: "visible" });

    let description = "";
    const heading = page.locator('h3:has-text("Job description")');
    if ((await heading.count()) > 0) {
      const part1 = await heading
        .nth(0)
        .locator("xpath=following-sibling::span[1]")
        .innerText();
      const part2 = await heading
        .nth(0)
        .locator("xpath=following-sibling::span[3]")
        .innerText();
      description = part1 + "\n" + part2;
    }

    const newJob = {
      id: "",
      title,
      url: jobUrl,
      company,
      location,
      jobDetails: dynamicJobFields,
      description,
    };

    const dirName = "google";
    const dir = path.join(dataDir, dirName);
    mkdirp.sync(dir);
    const filePath = path.join(dir, "jobs.json");
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf-8");
    }
    const prevJobs = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    fs.writeFileSync(filePath, JSON.stringify([...prevJobs, newJob], null, 2));
  }

  await browser.close();
})();
