import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const router = express.Router();

const FPL_USER_ID = process.env.FPL_USER_ID || "70171741";
const LEAGUE_ID = process.env.LEAGUE_ID;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const COOKIES = process.env.COOKIES;

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

// Basic league routes
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

export default router;
