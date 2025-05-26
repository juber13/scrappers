import express from 'express';

const router = express.Router();

import scrapeFacebookPosts from '../services/facebook.js';
import scrapeTwitter from '../services/twitter.js';
import pinterestScrapper from '../services/pinterest.js';
// import quoraScarapper from '../services/quora.js';
import scrapeInstagram from '../services/instagram.js';
import scrapeLinkedIn from '../services/linkedin.js'
import redditScrapper from '../services/reddit.js';



router.get('/facebook' , scrapeFacebookPosts);
router.get("/instagram", scrapeInstagram);
router.get("/twitter", scrapeTwitter);
router.get('/pinterest', pinterestScrapper);
// router.get('/quora', quoraScarapper);
router.get('/linkedin', scrapeLinkedIn);
router.get('/reddit', redditScrapper);



export default router;