
import { chromium } from "playwright";
import fs from 'fs'

async function scrapePinterest(query) {
  console.log("Starting Pinterest scraper...");
  let browser;

  try {
    // Launch browser with more explicit configuration
    console.log("Launching browser...");
    browser = await chromium.launch({
      headless: false,
      executablePath:
        process.platform === "win32"
          ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
          : undefined,
      args: [
        "--start-maximized",
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
      slowMo: 50,
    });

    console.log("Browser launched, creating new context...");
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      ignoreHTTPSErrors: true,
    });

    console.log("Creating new page...");
    const page = await context.newPage();
    const results = [];

    // Go to Pinterest search page
    const searchUrl = `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(
      query
    )}`;
    await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(5000);

    // Handle consent/login popup
    await handlePopups(page);

    // Scroll to load more pins
    const postLinks = await scrollAndCollectLinks(page, 60);
    console.log(`Found ${postLinks.length} unique post links.`);

    if (postLinks.length === 0) {
      console.log(
        "No pins found. Check screenshots for login/consent wall or selector issues."
      );
      return results;
    }

    // Scrape each post
    for (let i = 0; i < postLinks.length; i++) {
      const postUrl = postLinks[i];
      console.log(`Scraping post ${i + 1} of ${postLinks.length}: ${postUrl}`);

      const postData = await scrapePost(browser, postUrl);
      if (postData) {
        results.push({
          postUrl,
          ...postData,
        });
      }
    }

    // Save results
    if (results.length > 0) {
      const filename = `pinterest_${searchQuery.replace(
        /\s+/g,
        "_"
      )}_${Date.now()}.json`;
      fs.writeFileSync(filename, JSON.stringify(results, null, 2));
      console.log(`Scraping complete. Data saved to ${filename}`);
    }

    return results;
  } catch (error) {
    console.error("Error during scraping:", error);
    throw error; // Re-throw to handle in the main function
  } finally {
    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }
  }
}

async function handlePopups(page) {
  try {
    // Accept cookies/consent if present
    const consentBtn = await page.$('button:has-text("Accept")');
    if (consentBtn) {
      await consentBtn.click();
      await page.waitForTimeout(2000);
      console.log("Accepted consent/cookies.");
    }

    // Close login popup if present
    const closeLoginBtn = await page.$(
      'button[aria-label="Close"], button[aria-label="close"]'
    );
    if (closeLoginBtn) {
      await closeLoginBtn.click();
      await page.waitForTimeout(2000);
      console.log("Closed login popup.");
    }
  } catch (e) {
    console.log("No popups to handle or error handling popups:", e.message);
  }
}

async function scrollAndCollectLinks(page, maxScrolls) {
  let lastCount = 0;
  let sameCountTimes = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await page.mouse.wheel(0, 12000);
    await page.waitForTimeout(3500);

    const pinCount = await page.evaluate(
      () => document.querySelectorAll('a[href*="/pin/"]').length
    );

    if (pinCount === lastCount) {
      sameCountTimes++;
      if (sameCountTimes > 10) break;
    } else {
      sameCountTimes = 0;
      lastCount = pinCount;
    }

    if (i % 10 === 0)
      console.log(`Scrolled ${i} times, found ${pinCount} pins so far...`);
  }

  // Get all unique post links
  return await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href*="/pin/"]'));
    return anchors
      .map((a) => a.href)
      .filter(
        (href, idx, arr) =>
          arr.indexOf(href) === idx && /\/pin\/(\d+)/.test(href)
      );
  });
}

async function scrapePost(browser, postUrl) {
  const postPage = await browser.newPage();

  try {
    await postPage.goto(postUrl, { waitUntil: "networkidle", timeout: 30000 });
    await handlePopups(postPage);

    // Wait for any of these elements with increased timeout
    try {
      await postPage.waitForSelector(
        [
          '[data-test-id="closeup-image"] img',
          '[data-test-id="closeup-title"] h1',
          'meta[property="og:image"]',
          '[data-test-id="pin-with-alt-text"] img',
          '[data-test-id="rich-pin-information"]',
        ].join(","),
        { timeout: 30000 }
      );
    } catch (e) {
      console.log(
        `Timeout waiting for selectors on ${postUrl}, but continuing...`
      );
    }

    await postPage.waitForTimeout(3000);

    return await postPage.evaluate(() => {
      function getImageUrl() {
        const selectors = [
          '[data-test-id="closeup-image"] img',
          '[data-test-id="pin-with-alt-text"] img',
          'meta[property="og:image"]',
          'img[src*="pinimg.com"]',
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const element of elements) {
            if (element.tagName === "META") return element.content;
            if (element.src) return element.src;
            if (element.srcset) {
              const srcset = element.srcset
                .split(",")
                .map((s) => s.trim().split(" ")[0]);
              return srcset[srcset.length - 1] || null;
            }
          }
        }
        return null;
      }

      function getComments() {
        const commentNodes = Array.from(
          document.querySelectorAll('[data-test-id="comment"]')
        );
        return commentNodes.map((node) => {
          const user =
            node.querySelector('[data-test-id="comment-user-name"]')
              ?.innerText || null;
          const text =
            node.querySelector('[data-test-id="comment-text"]')?.innerText ||
            null;
          const time =
            node.querySelector('[data-test-id="comment-timestamp"]')
              ?.innerText || null;

          const replyNodes = Array.from(
            node.querySelectorAll('[data-test-id="reply"]')
          );
          const replies = replyNodes.map((replyNode) => ({
            user:
              replyNode.querySelector('[data-test-id="comment-user-name"]')
                ?.innerText || null,
            text:
              replyNode.querySelector('[data-test-id="comment-text"]')
                ?.innerText || null,
            time:
              replyNode.querySelector('[data-test-id="comment-timestamp"]')
                ?.innerText || null,
          }));

          return { user, text, time, replies };
        });
      }

      // Get title with multiple fallbacks
      const title =
        document.querySelector('[data-test-id="closeup-title"] h1')
          ?.innerText ||
        document.querySelector('[data-test-id="rich-pin-information"] h1')
          ?.innerText ||
        document.querySelector("h1")?.innerText ||
        document.querySelector('meta[property="og:title"]')?.content ||
        null;

      // Get description with multiple fallbacks
      const description =
        document.querySelector(
          '[data-test-id="richPinInformation-description"] span'
        )?.innerText ||
        document.querySelector('[data-test-id="truncated-description"] span')
          ?.innerText ||
        document.querySelector('meta[name="description"]')?.content ||
        document.querySelector('meta[property="og:description"]')?.content ||
        null;

      return {
        title,
        description,
        imageUrl: getImageUrl(),
        link:
          document.querySelector('[data-test-id="maybe-clickthrough-link"] a')
            ?.href ||
          document.querySelector('[data-test-id="rich-pin-information"] a')
            ?.href ||
          document.querySelector('meta[property="og:url"]')?.content ||
          null,
        author: {
          name:
            document.querySelector('[data-test-id="creator-profile-name"]')
              ?.innerText ||
            document.querySelector(
              '[data-test-id="creator-card-profile"] [data-test-id="creator-profile-name"]'
            )?.innerText ||
            null,
          profileUrl:
            document.querySelector('[data-test-id="creator-profile-link"]')
              ?.href ||
            document.querySelector('[data-test-id="creator-avatar-link"]')
              ?.href ||
            null,
        },
        comments: getComments(),
      };
    });
  } catch (error) {
    console.error(`Error scraping post ${postUrl}:`, error.message);
    return null;
  } finally {
    await postPage.close();
  }
}

// Main execution function
async function main(req , res) {
  const {query} = req.query;
  try {
    console.log("Starting main function...");
    const results = await scrapePinterest(query);
    console.log(`Scraping completed. Found ${results.length} posts.`);
    res.status(200).json({ message: "Data saved successfully" , results});

  } catch (error) {
    console.error("Fatal error:", error);
  }
}

// Run the scraper
// main().catch(console.error);

export default main