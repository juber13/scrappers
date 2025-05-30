import { chromium } from "playwright";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import readline from "readline";
import https from "https";
import http from "http";

dotenv.config();

const STORAGE_DIR = path.join(process.cwd(), "sessions");
const STORAGE_FILE = path.join(STORAGE_DIR, "twitter_session.json");



// Ensure sessions directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

async function validateSession(page) {
  try {
    // Try to access Twitter home
    await page.goto("https://twitter.com/home", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Check for login indicators
    const isLoggedIn = await page.evaluate(() => {
      const loginLink = document.querySelector('a[href="/login"]');
      const homeLink = document.querySelector('a[href="/home"]');
      const primaryColumn = document.querySelector('div[data-testid="primaryColumn"]');
      const composeTweet = document.querySelector('a[href="/compose/tweet"]');
      return !loginLink && (homeLink || primaryColumn || composeTweet);
    });

    if (isLoggedIn) {
      console.log("Session is valid");
      return true;
    }

    console.log("Session is invalid");
    return false;
  } catch (error) {
    console.log("Error validating session:", error.message);
    return false;
  }
}

async function saveSession(context) {
  try {
    const cookies = await context.cookies();
    const sessionData = {
      cookies,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(sessionData, null, 2));
    console.log("Session saved successfully");
  } catch (error) {
    console.error("Error saving session:", error.message);
  }
}

async function loadSession(context) {
  try {
    if (!fs.existsSync(STORAGE_FILE)) {
      console.log("No saved session found");
      return false;
    }

    const sessionData = JSON.parse(fs.readFileSync(STORAGE_FILE, "utf-8"));

    // Check if session is too old (older than 7 days)
    const sessionAge = new Date() - new Date(sessionData.timestamp);
    const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    if (sessionAge > MAX_SESSION_AGE) {
      console.log("Session is too old, needs refresh");
      return false;
    }

    await context.addCookies(sessionData.cookies);
    console.log("Session loaded successfully");
    return true;
  } catch (error) {
    console.error("Error loading session:", error.message);
    return false;
  }
}

// Helper function to download a file
async function downloadFile(url, dest) {
  const proto = url.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    proto
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Failed to get '${url}' (${response.statusCode})`));
          return;
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(dest, () => reject(err));
      });
  });
}

// Ensure media directory exists
const MEDIA_DIR = path.join(process.cwd(), "media");
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

async function performLogin(page) {
  const username = process.env.TWITTER_USERNAME;
  const password = process.env.TWITTER_PASSWORD;

  await page.goto("https://twitter.com/login", { waitUntil: "networkidle" });

  // Wait for username input
  await page.waitForSelector('input[name="text"]', { timeout: 30000 });
  await page.fill('input[name="text"]', username);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2000);

  // Wait for password input (sometimes Twitter asks for email confirmation instead)
  await page.waitForSelector('input[name="password"]', { timeout: 30000 });
  await page.fill('input[name="password"]', password);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(5000);
}




async function scrapeTwitterSearch(query, maxPost) {
  await performLogin(page);
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--window-size=1920,1080",
    ],
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 700 },
  });

  const page = await context.newPage();

  try { 
    // Wait for user to log in manually
    console.log("Please log in to Twitter manually in the opened browser window.");
    await page.goto("https://twitter.com/home", {waitUntil: "networkidle",timeout: 60000,});
    await page.waitForTimeout(30000); // Give user 30 seconds to log in

    // Go to Explore tab in sidebar
    console.log("Clicking Explore tab...");
    const exploreSelectors = [
      'a[href="/explore"]',
      'a[href="/explore/tabs/for-you"]',
      'div[data-testid="AppTabBar_Explore_Link"]',
      'a[aria-label="Explore"]',
    ];
    let exploreClicked = false;
    for (const selector of exploreSelectors) {
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        await page.click(selector);
        exploreClicked = true;
        console.log("Found and clicked Explore tab");
        break;
      } catch (e) {
        continue;
      }
    }
    if (!exploreClicked) {
      throw new Error("Could not find Explore tab");
    }

    // Wait for the search bar to be visible
    console.log("Waiting for search bar...");
    await page.waitForSelector('input[data-testid="SearchBox_Search_Input"]', {
      timeout: 30000,
      state: "visible",
    });

    // Click the search bar and enter the query
    console.log("Entering search query...");
    await page.click('input[data-testid="SearchBox_Search_Input"]');
    await page.fill('input[data-testid="SearchBox_Search_Input"]', query);
    await page.keyboard.press("Enter");

    // Wait for search results to load
    console.log("Waiting for search results...");
    await page.waitForSelector('article[data-testid="tweet"]', {
      timeout: 60000,
      state: "attached",
    });
    await page.waitForTimeout(3000);

    // Scroll to load more tweets and visit detail pages for comments
    console.log("Scrolling to load more tweets and grabbing comments...");
    let tweets = [];
    let seenUrls = new Set();
    let lastHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 20;

    while (tweets.length < maxPost && scrollAttempts < maxScrollAttempts) {
      // Extract tweet URLs from current view
      const newTweetData = await page.evaluate(() => {
        const tweetElements = document.querySelectorAll(
          'article[data-testid="tweet"]'
        );
        return Array.from(tweetElements)
          .map((tweet) => {
            try {
              // Skip sponsored/promoted tweets
              const isSponsored =
                tweet.innerText.includes("Promoted") ||
                tweet.innerText.includes("Sponsored");
              if (isSponsored) return null;

              // Get tweet text
              const textElement = tweet.querySelector(
                'div[data-testid="tweetText"]'
              );
              const text = textElement ? textElement.innerText : "";

              // Get author info
              const authorElement = tweet.querySelector(
                'div[data-testid="User-Name"]'
              );
              const author = authorElement
                ? authorElement.innerText.split("\n")[0]
                : "";

              // Get timestamp
              const timeElement = tweet.querySelector("time");
              const timestamp = timeElement
                ? timeElement.getAttribute("datetime")
                : "";

              // Get engagement metrics
              const getMetric = (testId) => {
                const element = tweet.querySelector(
                  `div[data-testid="${testId}"]`
                );
                if (!element) return "0";
                const text = element.innerText;
                if (text.includes("K"))
                  return (parseFloat(text) * 1000).toString();
                if (text.includes("M"))
                  return (parseFloat(text) * 1000000).toString();
                return text.replace(/[^0-9]/g, "") || "0";
              };

              const likes = getMetric("like");
              const retweets = getMetric("retweet");
              const replies = getMetric("reply");

              // Get tweet URL
              const linkElement = tweet.querySelector('a[href*="/status/"]');
              const url = linkElement
                ? `https://twitter.com${linkElement.getAttribute("href")}`
                : "";

              // Get tweet images if any
              const images = Array.from(
                tweet.querySelectorAll('img[alt="Image"]')
              )
                .map((img) => img.src)
                .filter((src) => src && !src.includes("profile_images"));

              return {
                text,
                author,
                timestamp,
                likes,
                retweets,
                replies,
                url,
                images,
                scraped_at: new Date().toISOString(),
              };
            } catch (error) {
              return null;
            }
          })
          .filter((tweet) => tweet !== null && tweet.text && tweet.url);
      });

      // For each new tweet, visit detail page for comments if not already seen
      for (const tweet of newTweetData) {
        if (!seenUrls.has(tweet.url) && tweets.length < maxPost) {
          seenUrls.add(tweet.url);
          // Visit tweet detail page to grab comments
          try {
            await page.goto(tweet.url, {
              waitUntil: "networkidle",
              timeout: 60000,
            });
            await page.waitForTimeout(2000);
            // Grab all visible comments (replies) that are not the main tweet
            const comments = await page.evaluate(() => {
              const allTweetTexts = Array.from(
                document.querySelectorAll('div[data-testid="tweetText"]')
              );
              return allTweetTexts
                .slice(1)
                .map((el) => el.innerText)
                .filter(Boolean);
            });
            tweet.comments = comments;
            console.log(
              `Grabbed ${comments.length} comments for tweet: ${tweet.url}`
            );
            // Go back to search page
            await page.goBack({ waitUntil: "networkidle", timeout: 60000 });
            await page.waitForTimeout(1000);
          } catch (err) {
            console.log(`Failed to grab comments for tweet: ${tweet.url}`);
            tweet.comments = [];
          }
          tweets.push(tweet);
          console.log(
            `Collected tweet ${
              tweets.length
            }/${maxPost}: ${tweet.text.substring(0, 50)}...`
          );
          // Download images
          tweet.localImages = [];
          if (tweet.images && tweet.images.length > 0) {
            for (let i = 0; i < tweet.images.length; i++) {
              const imgUrl = tweet.images[i];
              const tweetId =
                tweet.url.split("/status/")[1]?.split("?")[0] ||
                `tweet${tweets.length}`;
              const ext =
                path.extname(new URL(imgUrl).pathname).split("?")[0] || ".jpg";
              const imgFile = path.join(MEDIA_DIR, `${tweetId}_img${i}${ext}`);
              try {
                await downloadFile(imgUrl, imgFile);
                tweet.localImages.push(imgFile);
                console.log(`Downloaded image: ${imgFile}`);
              } catch (err) {
                console.log(`Failed to download image: ${imgUrl}`);
              }
            }
          }
          // Attempt to find and download video (if any)
          tweet.localVideos = [];
          const videoUrls = await page.evaluate(() => {
            // Twitter videos are in <video> tags or as m3u8/mp4 in source tags
            const videos = Array.from(document.querySelectorAll("video"));
            let urls = [];
            for (const vid of videos) {
              if (vid.src) urls.push(vid.src);
              const sources = vid.querySelectorAll("source");
              for (const s of sources) {
                if (s.src) urls.push(s.src);
              }
            }
            // Remove duplicates
            return Array.from(new Set(urls));
          });
          for (let i = 0; i < videoUrls.length; i++) {
            const vidUrl = videoUrls[i];
            const tweetId =
              tweet.url.split("/status/")[1]?.split("?")[0] ||
              `tweet${tweets.length}`;
            const ext =
              path.extname(new URL(vidUrl).pathname).split("?")[0] || ".mp4";
            const vidFile = path.join(MEDIA_DIR, `${tweetId}_vid${i}${ext}`);
            try {
              await downloadFile(vidUrl, vidFile);
              tweet.localVideos.push(vidFile);
              console.log(`Downloaded video: ${vidFile}`);
            } catch (err) {
              console.log(`Failed to download video: ${vidUrl}`);
            }
          }
        }
      }

      // Scroll to load more tweets
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(2000);

      // Check if we've reached the bottom
      const newHeight = await page.evaluate(() => document.body.scrollHeight);
      if (newHeight === lastHeight) {
        scrollAttempts++;
        console.log(
          `No new tweets loaded, attempt ${scrollAttempts}/${maxScrollAttempts}`
        );
      } else {
        scrollAttempts = 0;
        lastHeight = newHeight;
      }
    }

    // Save to file
    const filename = `${query
      .replace(/[^a-z0-9]/gi, "_")
      .toLowerCase()}_tweets.json`;
    fs.writeFileSync(filename, JSON.stringify(tweets, null, 2));
    console.log(`\nScraped ${tweets.length} tweets for "${query}"`);
    console.log(`Results saved to ${filename}`);
    return tweets;
  } catch (error) {
    console.error("Error during scraping:", error);
    try {
      await page.screenshot({ path: "error_screenshot.png" });
      console.log("Error screenshot saved as error_screenshot.png");
    } catch (screenshotError) {
      console.error("Failed to save error screenshot:", screenshotError);
    }
  } finally {
    await browser.close();
  }
}

// Modify the main execution
async function main(req , res) {
  const {query} = req.query;
  try {
    const data = await scrapeTwitterSearch(query, 50);
    res.status(200).json({ message: "Scraping completed successfully" , data });
  } catch (error) {
    console.error("Error in main execution:", error);
  }
}

// Run the main function
// main();


export default main
