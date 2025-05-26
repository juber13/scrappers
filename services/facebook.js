import { chromium } from "playwright";
import fs from "fs";
import * as cheerio from "cheerio";

async function scrapeFacebookPosts(req, res) {
  const {query} = req.query;
  console.log(query);
  

  let browser;
  let page;

  try {
    browser = await chromium.launchPersistentContext("./fb-profile", {
      headless: false,
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      args: ["--no-sandbox", "--disable-gpu"],
      ignoreDefaultArgs: ["--enable-automation"],
    });

    page = await browser.newPage();
    page.setDefaultTimeout(120000);
    page.setDefaultNavigationTimeout(120000);

    console.log("Navigating to Facebook...");
    await page.goto("https://www.facebook.com", {
      waitUntil: "domcontentloaded",
    });

    const searchUrl = `https://www.facebook.com/search/top/?q=${encodeURIComponent(
      query
    )}`;
    console.log("Navigating to search results:", searchUrl);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    console.log("Waiting for posts to load...");
    await page.waitForSelector('[role="article"]', { timeout: 30000 });

    let posts = new Set();
    let lastHeight = await page.evaluate(() => document.body.scrollHeight);
    let noNewPostsCount = 0;
    const maxNoNewPosts = 5;

    while (true) {
      console.log("Scrolling down...");
      await page.evaluate(() => window.scrollBy(0, window.innerHeight));

      await page
        .waitForFunction(`document.body.scrollHeight > ${lastHeight}`, {
          timeout: 10000,
        })
        .catch(() => console.log("No new posts detected, checking further..."));

      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === lastHeight) {
        noNewPostsCount++;
        if (noNewPostsCount >= maxNoNewPosts) {
          console.log("No new posts loading. Stopping scroll.");
          break;
        }
      } else {
        noNewPostsCount = 0;
      }
      lastHeight = newHeight;

      console.log("Extracting posts...");
      const html = await page.content();
      const $ = cheerio.load(html);

      $('[role="article"]').each(async (_, article) => {
        try {
          const channelName = $(article).find("span").text().trim();
          let titleElement = $(article).find('div[dir="auto"]');

          // Click "See More" if present to get full text
          const seeMoreButton = titleElement.find(
            'div[role="button"]:contains("See More")'
          );
          if (seeMoreButton.length > 0) {
            console.log('Expanding "See More" content...');
            await page.evaluate((btn) => btn.click(), seeMoreButton[0]);
            await page.waitForTimeout(1000);
          }

          const title = titleElement.text().trim();
          const description = $(article)
            .find('[data-ad-preview="message"]')
            .text()
            .trim();
          const link = $(article).find('a[href*="/posts/"]').attr("href") || "";

          // Click "Comments" if available and scrape comments
          const commentsButton = $(article).find(
            'div[role="button"]:contains("Comments")'
          );
          let comments = [];
          if (commentsButton.length > 0) {
            console.log("Expanding comments...");
            await page.evaluate((btn) => btn.click(), commentsButton[0]);
            await page.waitForTimeout(2000);

            // Scrape comments
            comments = $(article)
              .find('[aria-label="Comment"]')
              .map((_, comment) => $(comment).text().trim())
              .get();
          }

          if (channelName || title || description) {
            posts.add({
              channel_name: channelName,
              title,
              description,
              link,
              comments,
              scraped_at: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error("Error extracting post:", error);
        }
      });
    }

    const results = Array.from(posts);
    // const filename = `facebook_search_results_${Date.now()}.json`;
    // // await fs.writeFile(filename, JSON.stringify(results, null, 2));
    // fs.writeFile("output.json", data, (err) => {
    //   if (err) {
    //     console.error("Error writing file:", err);
    //   } else {
    //     console.log("File written successfully");
    //   }
    // });

    res.status(200).json({ message: "Posts scraped successfully", results });
    return results;
  } catch (error) {
    console.error("Fatal error during scraping:", error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// scrapeFacebookPosts("cyber security course in delhi")
//   .then((posts) => console.log(`Scraped ${posts.length} posts successfully`))
//   .catch((error) => console.error("Scraping failed:", error));

export default scrapeFacebookPosts;