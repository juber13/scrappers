import json
from playwright.sync_api import sync_playwright

def scrape_github_trending():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)  # Run in headless mode
        page = browser.new_page()
        page.goto("https://github.com/trending")

        repos = page.locator("article.Box-row")
        data = []

        for i in range(repos.count()):
            repo_name = repos.nth(i).locator("h2 a").text_content().strip()
            repo_link = f"https://github.com{repos.nth(i).locator('h2 a').get_attribute('href')}"
            repo_desc = repos.nth(i).locator("p").text_content()
            repo_stars = repos.nth(i).locator("a[href$='/stargazers']").text_content().strip()

            data.append({
                "repository": repo_name,
                "link": repo_link,
                "description": repo_desc,
                "stars": repo_stars
            })

        browser.close()

        # Save to JSON file
        with open("github_trending.json", "w", encoding="utf-8") as file:
            json.dump(data, file, indent=4)

        print("Scraping complete! Data saved to github_trending.json")

scrape_github_trending()