import express from "express";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
import dotenv from "dotenv";
import path from "path";
import fs from "fs/promises";

dotenv.config();
const router = express.Router();

const FPL_USER_ID = process.env.FPL_USER_ID || "70171741";
const LEAGUE_ID = process.env.LEAGUE_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const COOKIES = process.env.COOKIES;

// Cache for performance
let playersCache = null;
let lastCacheUpdate = null;
const CACHE_DURATION = 300000; // 5 minutes

// Screenshot storage
const SCREENSHOTS_DIR = './screenshots';

async function ensureScreenshotsDir() {
  try {
    await fs.access(SCREENSHOTS_DIR);
  } catch {
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });
  }
}

async function fetchWithAuth(url) {
  const headers = {};
 
  if (ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${ACCESS_TOKEN}`;
  } else if (COOKIES) {
    headers['Cookie'] = COOKIES;
  }
 
  console.log(`Fetching: ${url}`);
  console.log(`Using auth method: ${ACCESS_TOKEN ? 'Bearer Token' : COOKIES ? 'Cookies' : 'No Auth'}`);
 
  try {
    const response = await fetch(url, { headers });
    const data = await response.json();
   
    if (!response.ok) {
      console.error(`API Error (${response.status}):`, data);
      throw new Error(`API returned ${response.status}: ${JSON.stringify(data)}`);
    }
   
    return data;
  } catch (error) {
    console.error(`Fetch error for ${url}:`, error.message);
    throw error;
  }
}

// EXISTING ROUTES (YOUR ORIGINAL CODE)
router.get("/my-team", async (req, res) => {
  try {
    const team = await fetchWithAuth(`https://fantasy.premierleague.com/api/me/`);
    res.json(team);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/my-league", async (req, res) => {
  try {
    if (!LEAGUE_ID) {
      return res.status(400).json({ error: "LEAGUE_ID not configured in .env file" });
    }
    const league = await fetchWithAuth(`https://fantasy.premierleague.com/api/leagues-classic/${LEAGUE_ID}/standings/`);
    res.json(league);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/test-auth", async (req, res) => {
  try {
    const user = await fetchWithAuth(`https://fantasy.premierleague.com/api/me/`);
    console.log("User:", user);
   
    res.json({
      message: "Authentication working! ✅",
      user_id: user.player?.entry || FPL_USER_ID,
      user_name: `${user.player?.first_name || 'Unknown'} ${user.player?.last_name || 'User'}`,
      auth_method: ACCESS_TOKEN ? 'Bearer Token' : COOKIES ? 'Cookies' : 'None'
    });
  } catch (error) {
    res.status(500).json({
      error: "Authentication failed ❌",
      details: error.message,
      suggestion: "Check your ACCESS_TOKEN or COOKIES in .env file"
    });
  }
});

// UPDATED: Real screenshot capture functionality
async function captureRealTeamScreenshot(entryId, currentGW) {
  let browser = null;
  
  try {
    console.log(`📸 Starting real screenshot capture for team ${entryId}...`);
    
    // Launch headless browser
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
        '--disable-gpu'
      ]
    });
    
    const page = await browser.newPage();
    
    // Set viewport for consistent screenshots
    await page.setViewport({ width: 1200, height: 800 });
    
    // Set cookies if available for authentication
    if (COOKIES) {
      const cookieString = COOKIES;
      const cookies = cookieString.split(';').map(cookie => {
        const [name, value] = cookie.trim().split('=');
        return {
          name: name.trim(),
          value: value?.trim() || '',
          domain: '.fantasy.premierleague.com'
        };
      });
      
      await page.setCookie(...cookies);
    }
    
    // Navigate to team page
    const teamUrl = `https://fantasy.premierleague.com/entry/${entryId}/event/${currentGW}`;
    console.log(`🌐 Navigating to: ${teamUrl}`);
    
    await page.goto(teamUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Wait for the team content to load
    await page.waitForSelector('.Pitch__PitchElementContainer', { timeout: 10000 });
    
    // Hide unnecessary elements for cleaner screenshot
    await page.evaluate(() => {
      // Hide header, navigation, ads, etc.
      const elementsToHide = [
        'header',
        '.Layout__Header',
        '.Navigation',
        '.SidebarLayout__sidebar',
        '.Layout__Footer',
        'nav',
        '.Banner',
        '[data-testid="ad"]',
        '.advertisement'
      ];
      
      elementsToHide.forEach(selector => {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => el.style.display = 'none');
      });
      
      // Focus on the main pitch area
      const pitchContainer = document.querySelector('.Pitch__PitchElementContainer');
      if (pitchContainer) {
        pitchContainer.style.margin = '20px auto';
        pitchContainer.style.maxWidth = '800px';
      }
    });
    
    // Take screenshot of the team formation
    const screenshot = await page.screenshot({
      clip: {
        x: 200,
        y: 100,
        width: 800,
        height: 600
      },
      type: 'png'
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
    console.error(`❌ Screenshot capture failed for team ${entryId}:`, error.message);
    return {
      success: false,
      error: error.message
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// NEW: Real team screenshots endpoint
router.get("/capture-teams", async (req, res) => {
  try {
    if (!LEAGUE_ID) {
      return res.status(400).json({ error: "LEAGUE_ID not configured" });
    }

    console.log('📸 Starting real team screenshot captures...');
    
    // Get current gameweek
    const eventsResponse = await fetch('https://fantasy.premierleague.com/api/events/');
    const events = await eventsResponse.json();
    const currentGW = events.find(e => e.is_current)?.id || events.find(e => !e.finished)?.id || 1;
    
    // Get league standings
    const leagueData = await fetchWithAuth(
      `https://fantasy.premierleague.com/api/leagues-classic/${LEAGUE_ID}/standings/`
    );
    
    const topManagers = leagueData.standings.results.slice(0, 10);
    console.log(`📊 Capturing ${topManagers.length} team screenshots for GW${currentGW}...`);
    
    const captures = [];
    
    // Capture screenshots sequentially to avoid overwhelming the server
    for (const manager of topManagers) {
      console.log(`📸 Capturing ${manager.player_name} (${manager.entry_name})...`);
      
      const capture = await captureRealTeamScreenshot(manager.entry, currentGW);
      
      captures.push({
        entry_id: manager.entry,
        player_name: manager.player_name,
        team_name: manager.entry_name,
        rank: manager.rank,
        total_points: manager.total,
        gw_points: manager.event_total || 0,
        capture_result: capture,
        timestamp: new Date().toISOString()
      });
      
      // Small delay between captures
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    const successfulCaptures = captures.filter(c => c.capture_result.success);
    
    console.log(`✅ Completed ${successfulCaptures.length}/${captures.length} screenshots`);
    
    res.json({
      success: true,
      total_attempts: captures.length,
      successful_captures: successfulCaptures.length,
      captures: captures,
      gameweek: currentGW,
      league_name: leagueData.league.name,
      last_updated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Team capture process failed:', error);
    res.status(500).json({ 
      error: error.message,
      suggestion: "Check your authentication, league ID, and ensure Puppeteer is installed"
    });
  }
});

// Serve screenshot images
router.get("/screenshot/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    
    await fs.access(filepath);
    res.sendFile(path.resolve(filepath));
  } catch (error) {
    res.status(404).json({ error: "Screenshot not found" });
  }
});

// Get screenshot as base64
router.get("/screenshot-base64/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    
    const imageBuffer = await fs.readFile(filepath);
    const base64 = imageBuffer.toString('base64');
    
    res.json({
      success: true,
      filename,
      base64: `data:image/png;base64,${base64}`
    });
  } catch (error) {
    res.status(404).json({ error: "Screenshot not found" });
  }
});

// EXISTING SCRAPER ROUTES (UPDATED TO WORK WITH REAL CAPTURES)
async function getPlayersData() {
  if (playersCache && lastCacheUpdate && Date.now() - lastCacheUpdate < CACHE_DURATION) {
    return playersCache;
  }
  
  const data = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
  const bootstrap = await data.json();
  
  playersCache = bootstrap.elements.reduce((acc, player) => {
    acc[player.id] = {
      name: `${player.first_name} ${player.second_name}`,
      position: ['GKP', 'DEF', 'MID', 'FWD'][player.element_type - 1],
      team: player.team,
      total_points: player.total_points,
      form: player.form,
      price: player.now_cost / 10
    };
    return acc;
  }, {});
  
  lastCacheUpdate = Date.now();
  return playersCache;
}

async function scrapeTeamData(entryId, currentGW) {
  try {
    const [teamResponse, playersData] = await Promise.all([
      fetchWithAuth(`https://fantasy.premierleague.com/api/entry/${entryId}/`),
      getPlayersData()
    ]);

    const picksResponse = await fetchWithAuth(
      `https://fantasy.premierleague.com/api/entry/${entryId}/event/${currentGW}/picks/`
    );

    return {
      entry_id: entryId,
      manager_name: `${teamResponse.player_first_name} ${teamResponse.player_last_name}`,
      team_name: teamResponse.name,
      total_points: teamResponse.summary_overall_points,
      gw_points: teamResponse.summary_event_points,
      team_value: teamResponse.value,
      bank: teamResponse.bank,
      players: picksResponse.picks.slice(0, 11).map(pick => ({
        ...playersData[pick.element],
        is_captain: pick.is_captain,
        is_vice_captain: pick.is_vice_captain,
        multiplier: pick.multiplier
      }))
    };
  } catch (error) {
    console.error(`Failed to scrape team ${entryId}:`, error.message);
    return null;
  }
}

router.get("/live-teams", async (req, res) => {
  try {
    if (!LEAGUE_ID) {
      return res.status(400).json({ error: "LEAGUE_ID not configured" });
    }

    console.log('🔄 Starting live teams scraping...');
    
    const eventsResponse = await fetch('https://fantasy.premierleague.com/api/events/');
    const events = await eventsResponse.json();
    const currentGW = events.find(e => e.is_current)?.id || events.find(e => !e.finished)?.id || 1;
    
    const leagueData = await fetchWithAuth(
      `https://fantasy.premierleague.com/api/leagues-classic/${LEAGUE_ID}/standings/`
    );
    
    const topManagers = leagueData.standings.results.slice(0, 10);
    console.log(`📊 Scraping ${topManagers.length} teams for GW${currentGW}...`);
    
    const teams = [];
    const batchSize = 3;
    
    for (let i = 0; i < topManagers.length; i += batchSize) {
      const batch = topManagers.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (manager) => {
        const teamData = await scrapeTeamData(manager.entry, currentGW);
        if (teamData) {
          return {
            ...teamData,
            rank: manager.rank,
            total_points: manager.total,
            gw_points: manager.event_total || 0
          };
        }
        return null;
      });
      
      const batchResults = await Promise.all(batchPromises);
      teams.push(...batchResults.filter(team => team !== null));
      
      if (i + batchSize < topManagers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    console.log(`✅ Scraped ${teams.length} teams successfully`);
    
    res.json({
      success: true,
      teams: teams,
      gameweek: currentGW,
      league_name: leagueData.league.name,
      last_updated: new Date().toISOString(),
      total_scraped: teams.length
    });
    
  } catch (error) {
    console.error('❌ Live teams scraping failed:', error);
    res.status(500).json({ 
      error: error.message,
      suggestion: "Check your authentication and league ID"
    });
  }
});

router.get("/team-capture/:entryId", async (req, res) => {
  try {
    const { entryId } = req.params;
    
    const eventsResponse = await fetch('https://fantasy.premierleague.com/api/events/');
    const events = await eventsResponse.json();
    const currentGW = events.find(e => e.is_current)?.id || events.find(e => !e.finished)?.id || 1;
    
    const teamData = await scrapeTeamData(entryId, currentGW);
    
    if (!teamData) {
      return res.status(404).json({ error: "Team not found or access denied" });
    }
    
    res.json({
      success: true,
      team: teamData,
      capture_url: `https://fantasy.premierleague.com/entry/${entryId}/event/${currentGW}`,
      gameweek: currentGW
    });
    
  } catch (error) {
    console.error(`Team capture error for ${req.params.entryId}:`, error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/scraper-status", async (req, res) => {
  res.json({
    cache_age: lastCacheUpdate ? Date.now() - lastCacheUpdate : null,
    cache_valid: lastCacheUpdate && Date.now() - lastCacheUpdate < CACHE_DURATION,
    cached_players: playersCache ? Object.keys(playersCache).length : 0,
    auth_method: ACCESS_TOKEN ? 'Bearer Token' : COOKIES ? 'Cookies' : 'None',
    league_configured: !!LEAGUE_ID,
    ready_to_scrape: !!LEAGUE_ID && (!!ACCESS_TOKEN || !!COOKIES),
    screenshots_supported: true
  });
});

export default router;