
import dotenv from "dotenv";
import { chromium } from "playwright";
import fs from "fs";

dotenv.config();
async function loginLinkedIn(page) {
  await page.goto("https://www.linkedin.com/login", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('input[name="session_key"]', { timeout: 20000 });
  await page.fill('input[name="session_key"]', process.env.LINKEDIN_USERNAME);
  await page.fill(
    'input[name="session_password"]',
    process.env.LINKEDIN_PASSWORD
  );
  await page.click('button[type="submit"]');
  await page.waitForNavigation({
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
}

const linkdinScaraper = async (req , res) => {
  const {query} = req.query;
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  await loginLinkedIn(page);

  // Go to LinkedIn search for posts about cyber security
  const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(
    query
  )}&origin=SWITCH_SEARCH_VERTICAL`;
  console.log("Navigating to search URL:", searchUrl);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // Wait for content to load
  await page.waitForTimeout(5000);

  // Scroll to load more results
  console.log("Scrolling to load more results...");
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 10000);
    await page.waitForTimeout(2000);
  }

  // Take a screenshot after scrolling
  await page.screenshot({
    path: "linkedin-main-after-scroll.png",
    fullPage: true,
  });

  // Scrape post links with better debugging
  console.log("Extracting post links...");
  const postLinks = await page.evaluate(() => {
    // Log all links found for debugging
    const allLinks = Array.from(document.querySelectorAll("a"));
    console.log("Total links found:", allLinks.length);

    // Try different selectors for post links
    const possibleSelectors = [
      "a.app-aware-link",
      'a[href*="/feed/update/"]',
      'a[href*="/posts/"]',
      'a[href*="/pulse/"]',
    ];

    let links = [];
    for (const selector of possibleSelectors) {
      const elements = document.querySelectorAll(selector);
      console.log(`Selector "${selector}" found ${elements.length} elements`);
      if (elements.length > 0) {
        links = Array.from(elements)
          .map((a) => a.href)
          .filter(
            (href) =>
              href.includes("/feed/update/") ||
              href.includes("/posts/") ||
              href.includes("/pulse/")
          );
        if (links.length > 0) break;
      }
    }

    return links;
  });

  console.log("Found post links:", postLinks.length);
  if (postLinks.length === 0) {
    console.log("No post links found. Taking screenshot for debugging...");
    await page.screenshot({ path: "linkedin-search-results.png" });
    console.log("Screenshot saved as linkedin-search-results.png");
  }

  const results = await page.evaluate(() => {
    // Helper functions
    const getText = (el, sel) =>
      el.querySelector(sel)?.innerText.trim() || null;
    const getAttr = (el, sel, attr) =>
      el.querySelector(sel)?.getAttribute(attr) || null;

    // Try multiple selectors in the browser context
    let postNodes = Array.from(
      document.querySelectorAll(".reusable-search__result-container")
    );
    if (postNodes.length === 0) {
      postNodes = Array.from(
        document.querySelectorAll(".search-content__result")
      );
    }
    if (postNodes.length === 0) {
      postNodes = Array.from(
        document.querySelectorAll(".feed-shared-update-v2")
      );
    }
    console.log("Number of post nodes found:", postNodes.length);
    if (postNodes.length > 0) {
      console.log("First post HTML:", postNodes[0].outerHTML);
    }

    return postNodes.map((post) => {
      // Author info
      const userName =
        getText(
          post,
          '.update-components-actor__title span[dir="ltr"] span[aria-hidden="true"]'
        ) || getText(post, ".update-components-actor__title");
      const userProfileUrl =
        getAttr(post, ".update-components-actor__image", "href") ||
        getAttr(post, ".update-components-actor__meta-link", "href");
      const userRole =
        getText(
          post,
          '.update-components-actor__description span[aria-hidden="true"]'
        ) || getText(post, ".update-components-actor__description");

      // Post content
      const postTitle =
        getText(
          post,
          '.update-components-article-first-party__title span[dir="ltr"]'
        ) || getText(post, ".update-components-article-first-party__title");
      const postDescription =
        getText(post, ".update-components-text span.break-words") ||
        getText(post, ".feed-shared-update-v2__description");
      const postImageUrl =
        getAttr(
          post,
          ".update-components-article-first-party__image-container img",
          "src"
        ) || getAttr(post, ".ivm-view-attr__img--centered", "src");
      const postLink =
        getAttr(
          post,
          ".update-components-article-first-party__image-link",
          "href"
        ) ||
        getAttr(
          post,
          ".update-components-article-first-party__description-container a",
          "href"
        );

      // Comments (first-level only, as shown on main page)
      const commentNodes = Array.from(
        post.querySelectorAll(
          ".comments-comment-entity:not(.comments-comment-entity--reply)"
        )
      );
      const comments = commentNodes.map((commentNode) => {
        const commenterName =
          getText(commentNode, ".comments-comment-meta__description-title") ||
          getText(commentNode, ".comments-comment-meta__description");
        const commenterProfile =
          getAttr(commentNode, ".comments-comment-meta__image-link", "href") ||
          getAttr(
            commentNode,
            ".comments-comment-meta__description-container",
            "href"
          );
        const commenterRole = getText(
          commentNode,
          ".comments-comment-meta__description-subtitle"
        );
        const commentText =
          getText(commentNode, ".comments-comment-item__main-content") ||
          getText(commentNode, ".feed-shared-main-content--comment");
        const commentTime = getText(
          commentNode,
          ".comments-comment-meta__data"
        );

        // Replies (if any, as shown on main page)
        const replyNodes = Array.from(
          commentNode.querySelectorAll(".comments-comment-entity--reply")
        );
        const replies = replyNodes.map((replyNode) => ({
          userName:
            getText(replyNode, ".comments-comment-meta__description-title") ||
            getText(replyNode, ".comments-comment-meta__description"),
          userProfileUrl:
            getAttr(replyNode, ".comments-comment-meta__image-link", "href") ||
            getAttr(
              replyNode,
              ".comments-comment-meta__description-container",
              "href"
            ),
          userRole: getText(
            replyNode,
            ".comments-comment-meta__description-subtitle"
          ),
          commentText:
            getText(replyNode, ".comments-comment-item__main-content") ||
            getText(replyNode, ".feed-shared-main-content--comment"),
          timestamp: getText(replyNode, ".comments-comment-meta__data"),
        }));

        return {
          userName: commenterName,
          userProfileUrl: commenterProfile,
          userRole: commenterRole,
          commentText: commentText,
          timestamp: commentTime,
          replies: replies,
        };
      });

      return {
        userName,
        userProfileUrl,
        userRole,
        postTitle,
        postDescription,
        postImageUrl,
        postLink,
        comments,
      };
    });
  });

  console.log(`\nTotal posts collected: ${results.length}`);

  // Output results
  for (const [i, post] of results.entries()) {
    console.log(`\n--- Post ${i + 1} ---`);
    console.log("Title:", post.postTitle);
    console.log("Description:", post.postDescription);
    console.log("Image URL:", post.postImageUrl);
    console.log("Link:", post.postLink);
    if (post.comments.length > 0) {
      console.log("Comments:");
      post.comments.forEach((c, idx) => {
        console.log(`  - ${c.commentText}`);
        if (c.replies.length > 0) {
          console.log("    Replies:");
          c.replies.forEach((r) => console.log("      *", r.commentText));
        }
      });
    } else {
      console.log("No comments found.");
    }
  }

  // Save results to a file with error handling
  try {
    console.log("\nAttempting to save data to file...");
    console.log("Number of posts collected:", results.length);

    // Create the data object to save
    const dataToSave = {
      timestamp: new Date().toISOString(),
      totalPosts: results.length,
      posts: results,
    };


    // Check if we have data to save
    if (results.length === 0) {
      throw new Error("No data collected to save");
    }

    // Ensure the directory exists
    const dir = "./";
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Check if file is writable
    const filePath = "linkedin_cyber_security_posts.json";
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch (err) {
      throw new Error(`Directory is not writable: ${err.message}`);
    }

    // Write to file
    fs.writeFileSync(filePath, JSON.stringify(dataToSave, null, 2));

    // Verify the file was written
    const fileStats = fs.statSync(filePath);
    console.log(`\n✅ Data saved to ${filePath}`);
    console.log(`File size: ${fileStats.size} bytes`);

    // Verify the content
    const savedContent = fs.readFileSync(filePath, "utf8");
    const parsedContent = JSON.parse(savedContent);
    console.log(`Verified saved data: ${parsedContent.totalPosts} posts`);
    res.status(200).json({ message: "Data saved successfully" , dataToSave});
  } catch (error) {
    console.error("\n❌ Error saving data to file:", error.message);
    console.error("Error details:", error);
  }

  await browser.close();
};


export default linkdinScaraper;
