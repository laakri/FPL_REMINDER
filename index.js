import express from "express";
import fetch from "node-fetch";
import notifications from "./routes/notifications.js";
import league from "./routes/league.js";
import scraper from "./scraper.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS for all routes
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  next();
});

// Serve static files (for dashboard)
app.use(express.static('.'));

// Proxy route for FPL API to avoid CORS
app.get("/api/events", async (req, res) => {
  try {
    const response = await fetch('https://fantasy.premierleague.com/api/events/');
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard route
// app.get("/", (req, res) => {
//   res.sendFile('dashboard.html', { root: '.' });
// });

// Scraper route
// app.get("/scraper", (req, res) => {
//   res.sendFile('scraper.html', { root: '.' });
// });

// Health check route
app.get("/", (req, res) => {
  res.json({
    status: "FPL Notifier Server Running ✅",
    endpoints: {
      "/": "FPL Dashboard (HTML)",
      "/scraper": "FPL Team Scraper (HTML)",
      "/api/events": "Gameweek data (CORS-enabled)",
      "/league/my-team": "Your team data",
      "/league/my-league": "League standings",
      "/scraper/capture-all-teams": "Capture all top 8 teams simultaneously"
    }
  });
});

// Add league routes
app.use("/league", league);

// Add scraper routes
app.use("/scraper", scraper);

// Start notifications (runs in background every minute)
notifications.start();

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📸 FPL Scraper: http://localhost:${PORT}/scraper`);
});