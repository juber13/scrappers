import fs from "fs";
import path from "path";

async function scrapeQuoraSearch(page,searchQuery, maxAnswers = 10) {
  console.log(`Searching Quora for: "${searchQuery}"`);
  const queryUrl = `https://www.quora.com/search?q=${encodeURIComponent(searchQuery)}`;
  await page.goto(queryUrl, { waitUntil: "networkidle", timeout: 60000 });

  const searchResults = await page.$$("a[href^='/']");
  const results = [];

  for (const result of searchResults) {
    const href = await result.getAttribute("href");
    if (href && !href.includes("search") && !href.includes("profile")) {
      results.push(href);
    }
  }

  console.log(`Found ${results.length} search results`);

  const allData = [];
  for (const resultUrl of results) {
    if (allData.length >= maxAnswers) break;

    const targetUrl = "https://www.quora.com" + resultUrl;
    console.log(`Scraping Quora page: ${targetUrl}`);

    await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForSelector(".q-box.qu-display--block", { timeout: 30000 });

    const questionTitle = await page
      .$eval("h1", (el) => el.textContent.trim())
      .catch(() => "Unknown Question");

    let answers = [];
    let previousHeight = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 25;

    while (answers.length < maxAnswers && scrollAttempts < maxScrollAttempts) {
      const answerElements = await page.$$(".q-box.qu-display--block");

      for (const answerElement of answerElements) {
        const answerData = await extractAnswerData(page, answerElement);
        if (
          answerData &&
          !answers.find((a) => a.content === answerData.content)
        ) {
          answers.push(answerData);
        }
      }

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        return new Promise((resolve) => setTimeout(resolve, 2000));
      });

      const currentHeight = await page.evaluate(
        () => document.body.scrollHeight
      );

      if (currentHeight === previousHeight) {
        scrollAttempts++;
      } else {
        scrollAttempts = 0;
      }

      previousHeight = currentHeight;
      console.log(`Collected ${answers.length} answers so far...`);
    }

    const postData = {
      url: targetUrl,
      question: questionTitle,
      searchQuery,
      answers: answers.slice(0, maxAnswers),
      scrapedAt: new Date().toISOString(),
    };

    allData.push(postData);

    // const filename = path.join(OUTPUT_DIR,`${questionTitle.replace(/[^a-z0-9]/gi, "_").toLowerCase()}_${Date.now()}.json`);
    fs.writeFileSync('./quora.json', JSON.stringify(postData, null, 2));
    console.log(`Saved data to ${filename}`);
  }

  return allData;
}

// Make sure you define or import `extractAnswerData` somewhere accessible.


export default scrapeQuoraSearch;