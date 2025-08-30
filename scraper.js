import express from "express";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";

dotenv.config();
const router = express.Router();

const LEAGUE_ID = process.env.LEAGUE_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const COOKIES = process.env.COOKIES;

// Screenshot storage
const SCREENSHOTS_DIR = './screenshots';

async function ensureScreenshotsDir() {
  try {
    await fs.access(SCREENSHOTS_DIR);
  } catch {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  }
}

// Optimized screenshot capture with retry logic
async function captureRealTeamScreenshot(entryId, currentGW, retries = 2) {
  let browser = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      console.log(`📸 Attempt ${attempt + 1}/${retries + 1} for team ${entryId}...`);
      
      // Launch browser with optimized settings
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-features=TranslateUI',
          '--disable-ipc-flooding-protection',
          '--disable-web-security'
        ],
        timeout: 60000
      });
      
      const page = await browser.newPage();
      
      // Set viewport and user agent
      await page.setViewport({ width: 410, height: 1200, deviceScaleFactor: 1 });
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // Set cookies if available
      if (COOKIES) {
        const cookies = COOKIES.split(';').map(cookie => {
          const [name, value] = cookie.trim().split('=');
          return {
            name: name.trim(),
            value: value ? value.trim() : '',
            domain: '.premierleague.com'
          };
        });
        await page.setCookie(...cookies);
        console.log('✅ Cookies set');
      }
      
      // Set authentication headers
      if (ACCESS_TOKEN) {
        await page.setExtraHTTPHeaders({
          'Authorization': `Bearer ${ACCESS_TOKEN}`
        });
        console.log('✅ Bearer token set');
      }
      
      // Navigate with increased timeout and better error handling
      const teamUrl = `https://fantasy.premierleague.com/entry/${entryId}/event/${currentGW}`;
      console.log(`🌐 Navigating to: ${teamUrl}`);
      
      await page.goto(teamUrl, { 
        waitUntil: 'domcontentloaded', // Changed from networkidle2 for faster loading
        timeout: 45000 // Increased timeout
      });
      
      // Wait for essential content to load
      await page.waitForSelector('body', { timeout: 15000 });
      
      // Handle cookie modal
      try {
        await page.evaluate(() => {
          const cookieBtn = document.querySelector('#onetrust-accept-btn-handler, .onetrust-close-btn-handler, [data-testid="cookie-accept"]');
          if (cookieBtn) cookieBtn.click();
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (e) {
        console.log('No cookie modal found');
      }
      
      // Wait for team content to load with multiple selectors
      const teamSelectors = [
        'div[class*="Pitch"]',
        'div[class*="Formation"]',
        'div[class*="Team"]',
        '.Layout__Main',
        'main',
        '[data-testid="pitch"]'
      ];
      
      let teamLoaded = false;
      for (const selector of teamSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000 });
          teamLoaded = true;
          console.log(`✅ Team content loaded with selector: ${selector}`);
          break;
        } catch (e) {
          console.log(`Selector ${selector} not found, trying next...`);
        }
      }
      
      if (!teamLoaded) {
        console.log('⚠️ Specific team content not found, proceeding with page as-is');
      }
      
      // Additional wait for dynamic content
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Clean up page for better screenshot
      await page.evaluate(() => {
        // Hide unwanted elements
        const hideSelectors = [
          'header', 
          '.Layout__Header', 
          '.Navigation', 
          '.SidebarLayout__sidebar', 
          '.Layout__Footer', 
          'nav', 
          '.Banner',
          '.FixtureTable',
          '.TransferInfo',
          '.ads',
          '[class*="ad-"]',
          '.sticky-header'
        ];
        
        hideSelectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            if (el) el.style.display = 'none';
          });
        });
        
        // Scroll to top to ensure we capture the formation
        window.scrollTo(0, 0);
      });
      
      // Take screenshot with better settings
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const screenshot = await page.screenshot({
        type: 'png',
        clip: {
          x: 0,
          y: 0,
          width: 410,
          height: 600 // Reduced height to focus on team formation
        },
        captureBeyondViewport: false
      });
      
      // Save screenshot
      await ensureScreenshotsDir();
      const filename = `team_${entryId}_gw${currentGW}_${Date.now()}.png`;
      const filepath = path.join(SCREENSHOTS_DIR, filename);
      await fs.writeFile(filepath, screenshot);
      
      console.log(`✅ Screenshot saved: ${filename}`);
      
      return {
        success: true,
        filename,
        filepath,
        url: teamUrl,
        base64: screenshot.toString('base64')
      };
      
    } catch (error) {
      console.error(`❌ Attempt ${attempt + 1} failed for team ${entryId}:`, error.message);
      
      if (attempt === retries) {
        return {
          success: false,
          error: error.message
        };
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      
    } finally {
      if (browser) {
        await browser.close();
        browser = null;
      }
    }
  }
}

// Optimized sequential capture to avoid rate limiting
router.get("/capture-all-teams", async (req, res) => {
  try {
    console.log('🚀 Starting sequential capture of top 8 teams...');
    
    // Get current gameweek
    const eventsResponse = await fetch('https://fantasy.premierleague.com/api/events/');
    const events = await eventsResponse.json();
    const currentGW = events.find(e => e.is_current)?.id || events.find(e => !e.finished)?.id || 1;
    console.log(`📅 Current gameweek: ${currentGW}`);
    
    // Get league standings
    const leagueResponse = await fetch(`https://fantasy.premierleague.com/api/leagues-classic/${LEAGUE_ID}/standings/`, {
      headers: ACCESS_TOKEN ? { 'Authorization': `Bearer ${ACCESS_TOKEN}` } : {}
    });
    const leagueData = await leagueResponse.json();
    
    const topManagers = leagueData.standings.results.slice(0, 8);
    console.log(`📊 Found ${topManagers.length} managers to capture`);
    
    const results = [];
    
    // Capture teams sequentially with delays to avoid rate limiting
    for (let i = 0; i < topManagers.length; i++) {
      const manager = topManagers[i];
      console.log(`📸 Capturing ${manager.player_name} (${i + 1}/${topManagers.length})`);
      
      const result = await captureRealTeamScreenshot(manager.entry, currentGW);
      results.push({
        ...result,
        manager: manager
      });
      
      // Add delay between captures to avoid rate limiting
      if (i < topManagers.length - 1) {
        console.log('⏱️ Waiting 3 seconds before next capture...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    console.log(`🎉 Completed ${results.filter(r => r.success).length}/${results.length} captures`);
    
    res.json({
      success: true,
      captures: results,
      total_attempts: results.length,
      successful_captures: results.filter(r => r.success).length
    });
    
  } catch (error) {
    console.error('❌ Batch capture failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Single team capture endpoint for testing
router.get("/capture-team/:entryId", async (req, res) => {
  try {
    const { entryId } = req.params;
    
    // Get current gameweek
    const eventsResponse = await fetch('https://fantasy.premierleague.com/api/events/');
    const events = await eventsResponse.json();
    const currentGW = events.find(e => e.is_current)?.id || events.find(e => !e.finished)?.id || 1;
    
    console.log(`📸 Capturing single team: ${entryId} for GW${currentGW}`);
    
    const result = await captureRealTeamScreenshot(entryId, currentGW);
    
    if (result.success) {
      res.json({
        success: true,
        ...result
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('❌ Single capture failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Batch capture with limited parallelism
router.get("/capture-teams-batch", async (req, res) => {
  try {
    console.log('🚀 Starting batch capture with limited parallelism...');
    
    // Get current gameweek
    const eventsResponse = await fetch('https://fantasy.premierleague.com/api/events/');
    const events = await eventsResponse.json();
    const currentGW = events.find(e => e.is_current)?.id || events.find(e => !e.finished)?.id || 1;
    
    // Get league standings
    const leagueResponse = await fetch(`https://fantasy.premierleague.com/api/leagues-classic/${LEAGUE_ID}/standings/`, {
      headers: ACCESS_TOKEN ? { 'Authorization': `Bearer ${ACCESS_TOKEN}` } : {}
    });
    const leagueData = await leagueResponse.json();
    
    const topManagers = leagueData.standings.results.slice(0, 8);
    console.log(`📊 Found ${topManagers.length} managers to capture`);
    
    // Process in batches of 2 to reduce load
    const batchSize = 2;
    const results = [];
    
    for (let i = 0; i < topManagers.length; i += batchSize) {
      const batch = topManagers.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(topManagers.length/batchSize)}`);
      
      const batchPromises = batch.map(async (manager) => {
        const result = await captureRealTeamScreenshot(manager.entry, currentGW);
        return {
          ...result,
          manager: manager
        };
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Wait between batches
      if (i + batchSize < topManagers.length) {
        console.log('⏱️ Waiting 5 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
    
    console.log(`🎉 Completed ${results.filter(r => r.success).length}/${results.length} captures`);
    
    res.json({
      success: true,
      captures: results,
      total_attempts: results.length,
      successful_captures: results.filter(r => r.success).length
    });
    
  } catch (error) {
    console.error('❌ Batch capture failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;