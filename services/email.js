
import axios from 'axios'
import * as cheerio from 'cheerio';

async function scrapeEmails(url) {
  try {
    const { data: html } = await axios.get(url);
    const $ = cheerio.load(html);

    const pageText = $('body').text();
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-z]{2,}/g;
    const matches = pageText.match(emailRegex);

    const uniqueEmails = new Set(matches || []);
    console.log('Found emails:', Array.from(uniqueEmails));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

// Replace this URL with the site you want to scrape
scrapeEmails("https://unacademy.com");
