import { chromium } from "playwright";
import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import https from "https";
import http from "http";

dotenv.config();

const STORAGE = "storageState.json";

async function loginInstagram(context, page) {
  if (fs.existsSync(STORAGE)) {
    // Already logged in, just load the storage state
    await context.addCookies(
      JSON.parse(fs.readFileSync(STORAGE, "utf-8")).cookies
    );
    return;
  }

  // Go to login page
  await page.goto("https://www.instagram.com/accounts/login/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('input[name="username"]', { timeout: 20000 });
  console.log("Username input found");

  // Fill in credentials
  await page.fill('input[name="username"]', process.env.INSTAGRAM_USERNAME);
  await page.fill('input[name="password"]', process.env.INSTAGRAM_PASSWORD);

  await page.click('button[type="submit"]');

  // Wait for navigation to home or profile
  await page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Save cookies/session
  const cookies = await context.cookies();
  fs.writeFileSync(STORAGE, JSON.stringify({ cookies }, null, 2));
  console.log("Logged in and session saved!");
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

async function scrapeInstagram(req , res) {

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

 const {query} = req.query;
  // Login or reuse session
  await loginInstagram(context, page);

  // Go to the hashtag page
  await page.goto(`https://www.instagram.com/explore/tags/${query}/`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Dismiss popups if present
  try {
    await page.click("text=Not Now", { timeout: 5000 });
  } catch (e) {}
  try {
    await page.click("text=Not Now", { timeout: 5000 });
  } catch (e) {}
  try {
    await page.click("text=Accept All", { timeout: 5000 });
  } catch (e) {}

  // Wait for post containers to appear
  await page.waitForSelector('a[href^="/p/"] img', { timeout: 40000 });

  // Scroll to load more posts if needed
  let postData = [];
  while (postData.length < 10) {
    // Extract post data from the DOM
    const newPosts = await page.evaluate(() => {
      // Find all post links with images inside
      const anchors = Array.from(document.querySelectorAll('a[href^="/p/"]'));
      return anchors
        .map((a) => {
          // Check if the post is sponsored
          const isSponsored =
            a
              .closest("article")
              ?.querySelector('span[dir="auto"]:not([class*="_aacl"])')
              ?.textContent?.includes("Sponsored") ||
            a
              .closest("article")
              ?.querySelector('span[dir="auto"]:not([class*="_aacl"])')
              ?.textContent?.includes("Promoted") ||
            a
              .closest("article")
              ?.querySelector('span[dir="auto"]:not([class*="_aacl"])')
              ?.textContent?.includes("Paid partnership");

          // Skip sponsored posts
          if (isSponsored) {
            return null;
          }

          const img = a.querySelector("img");
          return {
            url: a.href.startsWith("http")
              ? a.href
              : `https://www.instagram.com${a.getAttribute("href")}`,
            img: img ? img.src : "",
            alt: img ? img.alt : "",
            isSponsored: false,
          };
        })
        .filter((post) => post !== null); // Remove null entries (sponsored posts)
    });
    // Add only unique posts
    for (const post of newPosts) {
      if (!postData.find((p) => p.url === post.url)) {
        postData.push(post);
      }
    }
    if (postData.length >= 10) break;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(2000);
  }
  postData = postData.slice(0, 10);

  const dismissPopups = async (page) => {
    const popupSelectors = [
      "text=Not Now",
      "text=Accept All",
      "text=Allow essential and optional cookies",
      "text=Allow all cookies",
      "text=Remind me later",
      "text=Close",
      '[aria-label="Close"]',
    ];
    for (const sel of popupSelectors) {
      try {
        await page.click(sel, { timeout: 2000 });
      } catch (e) {}
    }
  };

  // Visit each post to get full description and comments
  for (let [i, post] of postData.entries()) {
    const postPage = await context.newPage();
    try {
      await postPage.goto(post.url, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      await dismissPopups(postPage);

      // Check for sponsored content
      const isSponsored = await postPage.evaluate(() => {
        return (
          document
            .querySelector('span[dir="auto"]:not([class*="_aacl"])')
            ?.textContent?.includes("Sponsored") ||
          document
            .querySelector('span[dir="auto"]:not([class*="_aacl"])')
            ?.textContent?.includes("Promoted") ||
          document
            .querySelector('span[dir="auto"]:not([class*="_aacl"])')
            ?.textContent?.includes("Paid partnership")
        );
      });

      if (isSponsored) {
        console.log("Skipping sponsored post:", post.url);
        await postPage.close();
        continue;
      }

      // Check for "not available" or login wall
      const notAvailable = await postPage.$(
        "text=Sorry, this page isn't available, text=Log in to see photos and videos"
      );
      if (notAvailable) {
        post.error = "Post not available (private/deleted/region-locked)";
        await postPage.close();
        continue;
      }

      // Check for block/challenge
      const isBlocked = await postPage.$(
        "text=Try Again Later, text=Suspicious Login Attempt, text=Please wait a few minutes"
      );
      if (isBlocked) {
        post.error = "Blocked or challenge page";
        await postPage.close();
        continue;
      }

      // Wait for either article or the main post container
      try {
        await Promise.race([
          postPage.waitForSelector("article", { timeout: 80000 }),
          postPage.waitForSelector('div[role="button"]', { timeout: 80000 }),
        ]);
      } catch (err) {
        console.log("Waiting for alternative selectors...");
        // Try alternative selectors
        await Promise.race([
          postPage.waitForSelector('div[role="dialog"]', { timeout: 20000 }),
          postPage.waitForSelector("div._a9zr", { timeout: 20000 }),
        ]);
      }

      await dismissPopups(postPage);

      // Wait specifically for the caption to load
      try {
        await postPage.waitForSelector("div._a9zr div.xt0psk2 h1._ap3a", {
          timeout: 20000,
        });
      } catch (err) {
        console.log("Waiting for caption...");
      }

      // Scroll multiple times to ensure all content is loaded
      for (let i = 0; i < 3; i++) {
        await postPage.evaluate(() => {
          window.scrollBy(0, 500);
        });
        await postPage.waitForTimeout(2000);
      }

      // Extract all details from the post page
      const details = await postPage.evaluate(() => {
        // Main post details
        let author = "";
        const authorEl = document.querySelector(
          'header a[href^="/"] span, header a[href^="/"], a[href^="/"] span, a[href^="/"]'
        );
        if (authorEl) author = authorEl.textContent || authorEl.innerText || "";

        let date = "";
        const timeEl = document.querySelector("time._a9ze");
        if (timeEl) date = timeEl.getAttribute("datetime") || "";

        // Get caption using the exact DOM structure from the example
        let description = "";
        try {
          // First try the exact selector from the example
          const captionEl = document.querySelector(
            "span.x193iq5w.xeuugli.x1fj9vlw.x13faqbe.x1vvkbs.xt0psk2.x1i0vuye.xvs91rp.xo1l8bm.x5n08af.x10wh9bi.x1wdrske.x8viiok.x18hxmgj"
          );
          if (captionEl) {
            description = captionEl.innerText || captionEl.textContent || "";
            console.log("Found caption with exact selector:", description);
          }

          // If not found, try alternative selectors
          if (!description) {
            const altSelectors = [
              'span[style="line-height: 18px"]',
              'div[role="button"] span',
              "div._a9zr span",
              'div[role="dialog"] span',
            ];

            for (const selector of altSelectors) {
              const el = document.querySelector(selector);
              if (el && el.innerText && el.innerText.length > 0) {
                description = el.innerText || el.textContent || "";
                if (description) {
                  console.log(
                    "Found caption with alternative selector:",
                    selector,
                    description
                  );
                  break;
                }
              }
            }
          }
        } catch (err) {
          console.error("Error getting caption:", err);
        }

        let media = [];
        const imgEls = Array.from(
          document.querySelectorAll('article img, div[role="dialog"] img')
        );
        const videoEls = Array.from(
          document.querySelectorAll('article video, div[role="dialog"] video')
        );

        imgEls.forEach((img) => {
          if (img.src && !media.find((m) => m.url === img.src)) {
            media.push({ type: "image", url: img.src, alt: img.alt || "" });
          }
        });

        videoEls.forEach((video) => {
          if (video.src && !media.find((m) => m.url === video.src)) {
            media.push({
              type: "video",
              url: video.src,
              alt: video.getAttribute("aria-label") || "",
            });
          }
        });

        // --- SUB-POSTS ---
        const subPosts = [];

        // Find all sub-post containers including _aagw class
        const subPostContainers = document.querySelectorAll(
          'div[role="button"] li, div[role="dialog"] li, div._aagw'
        );

        for (const subPostEl of subPostContainers) {
          // Author
          let subAuthor = "";
          const subAuthorEl = subPostEl.querySelector(
            'a[href^="/"] span, a[href^="/"]'
          );
          if (subAuthorEl)
            subAuthor = subAuthorEl.innerText || subAuthorEl.textContent || "";

          // Description/Caption
          let subDesc = "";
          const subDescEl = subPostEl.querySelector(
            "span.x193iq5w.xeuugli.x1fj9vlw.x13faqbe.x1vvkbs.xt0psk2.x1i0vuye.xvs91rp.xo1l8bm.x5n08af.x10wh9bi.x1wdrske.x8viiok.x18hxmgj"
          );
          if (subDescEl) {
            subDesc = subDescEl.innerText || subDescEl.textContent || "";
          } else {
            // Try alternative selectors for caption
            const altSelectors = [
              'span[style="line-height: 18px"]',
              'div[role="button"] span',
              "div._a9zr span",
              "div._aagw span",
            ];
            for (const selector of altSelectors) {
              const el = subPostEl.querySelector(selector);
              if (el && el.innerText && el.innerText.length > 0) {
                subDesc = el.innerText || el.textContent || "";
                break;
              }
            }
          }

          // Date
          let subDate = "";
          const subTimeEl = subPostEl.querySelector("time");
          if (subTimeEl) subDate = subTimeEl.getAttribute("datetime") || "";

          // Media
          let subMedia = [];
          // Look for media in both the sub-post element and its parent
          const mediaElements = [
            ...Array.from(subPostEl.querySelectorAll("img")),
            ...Array.from(subPostEl.querySelectorAll("video")),
            ...Array.from(
              subPostEl.parentElement?.querySelectorAll("img") || []
            ),
            ...Array.from(
              subPostEl.parentElement?.querySelectorAll("video") || []
            ),
          ];

          mediaElements.forEach((media) => {
            if (media.src && !subMedia.find((m) => m.url === media.src)) {
              const type =
                media.tagName.toLowerCase() === "video" ? "video" : "image";
              subMedia.push({
                type,
                url: media.src,
                alt: media.alt || media.getAttribute("aria-label") || "",
              });
            }
          });

          // For _aagw elements, also check for background images
          if (subPostEl.classList.contains("_aagw")) {
            const style = window.getComputedStyle(subPostEl);
            const bgImage = style.backgroundImage;
            if (bgImage && bgImage !== "none") {
              const url = bgImage.replace(/^url\(['"](.+)['"]\)$/, "$1");
              if (url && !subMedia.find((m) => m.url === url)) {
                subMedia.push({
                  type: "image",
                  url: url,
                  alt: "Background image",
                });
              }
            }
          }

          // Only add sub-post if it has content
          if (subAuthor || subDesc || subMedia.length > 0) {
            subPosts.push({
              author: subAuthor,
              description: subDesc,
              date: subDate,
              media: subMedia,
              type: subPostEl.classList.contains("_aagw")
                ? "carousel_item"
                : "sub_post",
            });
          }
        }

        return { author, date, description, media, subPosts };
      });

      // Log the description for debugging
      console.log(`Post ${i + 1} description:`, details.description);
      console.log(
        `Post ${i + 1} full details:`,
        JSON.stringify(details, null, 2)
      );

      post.author = details.author;
      post.date = details.date;
      post.description = details.description;
      post.media = details.media;
      post.subPosts = details.subPosts;
      console.log(`Scraped post ${i + 1}/${postData.length}: ${post.url}`);

      // Download images
      post.localImages = [];
      if (details.media && details.media.length > 0) {
        for (let i = 0; i < details.media.length; i++) {
          const mediaItem = details.media[i];
          if (mediaItem.type === "image") {
            const imgUrl = mediaItem.url;
            const postId =
              post.url.split("/p/")[1]?.split("/")[0] || `post${i}`;
            const ext =
              path.extname(new URL(imgUrl).pathname).split("?")[0] || ".jpg";
            const imgFile = path.join(MEDIA_DIR, `${postId}_img${i}${ext}`);
            try {
              await downloadFile(imgUrl, imgFile);
              post.localImages.push(imgFile);
              console.log(`Downloaded image: ${imgFile}`);
            } catch (err) {
              console.log(`Failed to download image: ${imgUrl}`);
            }
          }
        }
      }
      // Download videos
      post.localVideos = [];
      if (details.media && details.media.length > 0) {
        for (let i = 0; i < details.media.length; i++) {
          const mediaItem = details.media[i];
          if (mediaItem.type === "video") {
            const vidUrl = mediaItem.url;
            const postId =
              post.url.split("/p/")[1]?.split("/")[0] || `post${i}`;
            const ext =
              path.extname(new URL(vidUrl).pathname).split("?")[0] || ".mp4";
            const vidFile = path.join(MEDIA_DIR, `${postId}_vid${i}${ext}`);
            try {
              await downloadFile(vidUrl, vidFile);
              post.localVideos.push(vidFile);
              console.log(`Downloaded video: ${vidFile}`);
            } catch (err) {
              console.log(`Failed to download video: ${vidUrl}`);
            }
          }
        }
      }
    } catch (err) {
      console.error(
        `Failed to scrape post ${i + 1}/${postData.length}: ${post.url}`
      );
      try {
        await postPage.screenshot({
          path: `error_post_${i + 1}.png`,
          timeout: 5000,
        });
      } catch (screenshotErr) {
        console.error(
          `Screenshot failed for post ${i + 1}:`,
          screenshotErr.message
        );
      }
      post.error = err.message;
    } finally {
      await postPage.close();
      await page.waitForTimeout(10000 + Math.random() * 10000); // 10-20 seconds between posts
    }
  }

  // Wait before closing browser for user review
  await page.waitForTimeout(30000); // 30 seconds
  await browser.close();

  // Save to file
  fs.writeFileSync(`${hashtag}_posts.json`, JSON.stringify(postData, null, 3));
   res.status(200).json({ message: "Data saved successfully", data: postData });

  console.log(`Scraped ${postData.length} posts for #${hashtag}`);
}

// Usage: Hashtags can't have spaces, so use underscores or remove spaces
// scrapeInstagramHashtag("innobuzz", 5);

export default scrapeInstagram;