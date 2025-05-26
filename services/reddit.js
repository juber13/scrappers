import { chromium } from "playwright";
import fs from "fs";


const redditScrapper = async(req , res) => {
  const {query} = req.query;
  try {
    console.log("Starting browser...");
    const browser = await chromium.launch({
      headless: false,
      args: [
        "--disable-web-security",
        "--disable-features=IsolateOrigins,site-per-process",
      ],
    });

    // Set a realistic user agent in the context
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
    });

    const page = await context.newPage();
    console.log("Browser started successfully");

    // Go to Reddit search page
    console.log("Navigating to Reddit search page...");
    await page.goto(
      `https://www.reddit.com/search/?q=${encodeURIComponent(query)}`,
      {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      }
    );

    // Give yourself time to solve CAPTCHA if it appears
    console.log("Waiting for potential CAPTCHA...");
    await page.waitForTimeout(15000);

    // Scroll multiple times to load all content on home page
    console.log("Scrolling to load all posts...");
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      await page.waitForTimeout(2000);
    }

    // Now try to find posts
    console.log("Looking for posts...");
    await page.waitForSelector('div[data-testid="search-post-unit"]', {
      timeout: 15000,
    });

    // Extract post titles and links
    console.log("Extracting post information...");
    const posts = await page.$$eval(
      'div[data-testid="search-post-unit"]',
      (elements) =>
        elements
          .map((el) => {
            const titleElement = el.querySelector(
              'a[data-testid="post-title-text"]'
            );
            return {
              title: titleElement ? titleElement.innerText.trim() : "",
              url: titleElement ? titleElement.href : "",
            };
          })
          .filter((post) => post.title && post.url)
    );

    // Process all posts in batches
    const BATCH_SIZE = 3;

    console.log(`Processing ${posts.length} posts in batches of ${BATCH_SIZE}`);

    for (let i = 0; i < posts.length; i += BATCH_SIZE) {
      const batch = posts.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (post) => {
          try {
            const postPage = await context.newPage();
            postPage.setDefaultTimeout(15000);

            let pageLoaded = false;
            let retryCount = 0;
            const maxRetries = 2;

            while (!pageLoaded && retryCount < maxRetries) {
              try {
                await postPage.goto(post.url, {
                  waitUntil: "domcontentloaded",
                  timeout: 15000,
                });

                const contentSelectors = [
                  'div[data-testid="post-content"]',
                  'div[data-testid="post"]',
                  'div[class*="Post"]',
                  'div[class*="post"]',
                ];

                for (const selector of contentSelectors) {
                  try {
                    await postPage.waitForSelector(selector, { timeout: 5000 });
                    pageLoaded = true;
                    break;
                  } catch (err) {
                    continue;
                  }
                }
              } catch (err) {
                retryCount++;
                if (retryCount < maxRetries) {
                  await postPage.waitForTimeout(2000);
                }
              }
            }

            if (!pageLoaded) {
              throw new Error("Failed to load page");
            }

            await loadAllComments(postPage);
            const [content, upvotes, comments] = await Promise.all([
              extractContent(postPage),
              extractUpvotes(postPage),
              extractComments(postPage),
            ]);

            post.answer = content;
            post.upvotes = upvotes;
            post.comments = comments;

            await postPage.close();
          } catch (err) {
            post.answer = "";
            post.upvotes = "0";
            post.comments = {};
          }
        })
      );

      if (i + BATCH_SIZE < posts.length) {
        await page.waitForTimeout(2000);
      }
    }

    console.log("\nSaving results to file...");
    fs.writeFileSync("test2.json", JSON.stringify(posts, null, 2));
    console.log("Results saved successfully");

    await browser.close();
    res.status(200).json({ message: "Data saved successfully" , posts});


    // After scraping is complete, import the data
    // await importData();
  } catch (error) {
    console.error("Fatal error:", error);
  }
};

// Helper function to extract content
async function extractContent(page) {
  const contentSelectors = [
    'div[data-post-click-location="text-body"] div.md',
    'div[data-post-click-location="text-body"] p',
    'div[data-testid="post-content"] div.md',
    'div[data-testid="post-content"] p',
  ];

  for (const selector of contentSelectors) {
    try {
      const content = await page.$eval(selector, (el) => {
        if (el.tagName.toLowerCase() === "p") {
          return el.innerText.trim();
        }
        const paragraphs = el.querySelectorAll("p");
        if (paragraphs.length > 0) {
          return Array.from(paragraphs)
            .map((p) => p.innerText.trim())
            .filter((text) => text)
            .join("\n\n");
        }
        return el.innerText.trim();
      });
      if (content) return content;
    } catch (err) {
      continue;
    }
  }
  return "";
}

// Function to extract upvotes
const extractUpvotes = async (page) => {
  try {
    // Try to find upvotes in the post page first
    try {
      // Wait for the action row to be present
      await page.waitForSelector('div[data-testid="action-row"]', {
        timeout: 5000,
      });

      // Try to get the upvote count from faceplate-number in the action row
      const upvoteText = await page.$eval(
        'div[data-testid="action-row"] faceplate-number',
        (el) => {
          // Get the text content and clean it
          const text = el.textContent.trim();
          // Remove any non-numeric characters except decimal point
          return text.replace(/[^0-9.]/g, "");
        }
      );

      if (upvoteText && upvoteText !== "0") {
        console.log(`Found upvotes in action row: ${upvoteText}`);
        return upvoteText;
      }

      // Fallback: try to get the number attribute
      const number = await page.$eval(
        'div[data-testid="action-row"] faceplate-number',
        (el) => {
          return el.getAttribute("number") || "0";
        }
      );

      if (number && number !== "0") {
        console.log(
          `Found upvotes from number attribute in action row: ${number}`
        );
        return number;
      }
    } catch (err) {
      console.log("Failed to find upvotes in action row:", err.message);
    }

    // If not found in action row, try the seeker-post-info-row
    try {
      await page.waitForSelector('div[data-testid="seeker-post-info-row"]', {
        timeout: 5000,
      });

      const upvoteText = await page.$eval(
        'div[data-testid="seeker-post-info-row"] faceplate-number',
        (el) => {
          const text = el.textContent.trim();
          return text.replace(/[^0-9.]/g, "");
        }
      );

      if (upvoteText && upvoteText !== "0") {
        console.log(`Found upvotes in seeker-post-info-row: ${upvoteText}`);
        return upvoteText;
      }

      // Fallback: try to get the number attribute
      const number = await page.$eval(
        'div[data-testid="seeker-post-info-row"] faceplate-number',
        (el) => {
          return el.getAttribute("number") || "0";
        }
      );

      if (number && number !== "0") {
        console.log(
          `Found upvotes from number attribute in seeker-post-info-row: ${number}`
        );
        return number;
      }
    } catch (err) {
      console.log(
        "Failed to find upvotes in seeker-post-info-row:",
        err.message
      );
    }

    console.log("No upvotes found in any location");
    return "0";
  } catch (err) {
    console.log("Failed to extract upvotes:", err.message);
    return "0";
  }
};

// Function to extract comments (recursive, threaded)
async function extractComments(page) {
  try {
    await page.waitForSelector("shreddit-comment", { timeout: 15000 });
  } catch (error) {
    console.log("No comments found");
    return [];
  }

  const comments = await page.evaluate(() => {
    // 1. Gather all comments in a flat list
    const allCommentEls = Array.from(
      document.querySelectorAll("shreddit-comment")
    );
    const commentMap = {};
    const roots = [];

    allCommentEls.forEach((commentEl) => {
      const thingid = commentEl.getAttribute("thingid");
      const parentid = commentEl.getAttribute("parentid");
      const content =
        commentEl
          .querySelector(`div[id="${thingid}-post-rtjson-content"] p`)
          ?.textContent?.trim() || "";
      const author = commentEl.getAttribute("author") || "[deleted]";
      const upvotes = commentEl.getAttribute("score") || "0";

      commentMap[thingid] = {
        id: thingid,
        parentid,
        text: content,
        author,
        upvotes,
        replies: [],
      };
    });

    // 2. Build the tree
    Object.values(commentMap).forEach((comment) => {
      if (comment.parentid && commentMap[comment.parentid]) {
        commentMap[comment.parentid].replies.push(comment);
      } else {
        roots.push(comment);
      }
    });

    return roots;
  });

  console.log("Extracted threaded comments:", comments);
  return comments;
}

// Function to wait for element with retry
const waitForElement = async (page, selector, timeout = 30000, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Attempt ${i + 1}/${retries} to find element: ${selector}`);
      await page.waitForSelector(selector, { timeout });
      return true;
    } catch (err) {
      console.log(`Attempt ${i + 1} failed: ${err.message}`);
      if (i < retries - 1) {
        console.log("Waiting 5 seconds before retry...");
        await page.waitForTimeout(5000);
      }
    }
  }
  return false;
};

// const uri = "mongodb+srv://juberinnobuzzin:juberkhan123@cluster0.4tvkrxn.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

// async function importData() {
//     const client = new MongoClient(uri, {
//         ssl: true,
//         tls: true,
//         tlsAllowInvalidCertificates: true,
//         tlsAllowInvalidHostnames: true,
//         serverSelectionTimeoutMS: 5000,
//         connectTimeoutMS: 10000
//     });

//     try {
//         await client.connect();
//         console.log("Connected to MongoDB");

//         const db = client.db("mydatabase");
//         const collection = db.collection("reddit");

//         // Read and parse the JSON file
//         const fileData = fs.readFileSync("test2.json", "utf-8");
//         const jsonData = JSON.parse(fileData);

//         // Ensure we have an array of documents
//         const documents = Array.isArray(jsonData) ? jsonData : [jsonData];

//         // Insert documents with error handling
//         try {
//             const result = await collection.insertMany(documents);
//             console.log(`Successfully inserted ${result.insertedCount} documents`);
//         } catch (insertError) {
//             console.error("Error inserting documents:", insertError);

//             // Try inserting one by one if bulk insert fails
//             console.log("Attempting to insert documents one by one...");
//             let successCount = 0;
//             for (const doc of documents) {
//                 try {
//                     await collection.insertOne(doc);
//                     successCount++;
//                 } catch (docError) {
//                     console.error("Error inserting document:", docError);
//                 }
//             }
//             console.log(`Successfully inserted ${successCount} documents individually`);
//         }

//     } catch (error) {
//         console.error("Error connecting to MongoDB:", error);
//     } finally {
//         try {
//             await client.close();
//             console.log("MongoDB connection closed");
//         } catch (closeError) {
//             console.error("Error closing MongoDB connection:", closeError);
//         }
//     }
// }

// Helper to expand all "load more replies" and scroll to load all comments
async function loadAllComments(page) {
  let tries = 0;
  while (tries < 20) {
    // up to 20 cycles, should be enough for most threads
    let found = false;
    // Find all buttons/spans that could load more comments
    const buttons = await page.$$("button, span");
    for (const btn of buttons) {
      const text = await btn.innerText().catch(() => "");
      if (
        text &&
        /load more replies|view more replies|continue this thread|load more comments|show more replies/i.test(
          text
        )
      ) {
        try {
          await btn.click();
          found = true;
          await page.waitForTimeout(1200); // wait for new comments to load
        } catch (e) {}
      }
    }
    // Scroll to bottom to trigger lazy loading
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    if (!found) break;
    tries++;
  }
}


export default redditScrapper;