import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();
const DISCORD_WEBHOOK = "process.env.DISCORD_WEBHOOK";

async function getNextDeadline() {
  const res = await fetch("https://fantasy.premierleague.com/api/events/");
  const data = await res.json();
  const events = Array.isArray(data) ? data : data.events;
  const now = new Date();
  return events.find(e => new Date(e.deadline_time) > now);
}

async function sendDiscordNotification(message) {
  if (!DISCORD_WEBHOOK) return;
  await fetch(DISCORD_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
}

function formatMessage(diffMinutes, gwName) {
  const diffHours = diffMinutes / 60;

  if (diffHours > 48) return `⏰ ${gwName} deadline in ${Math.floor(diffHours / 24)} days. Don’t sleep on it ya weldi 😏`;
  if (diffHours > 24) return `🚨 ${gwName} deadline is tomorrow! Don’t come crying later 7achtek bel wildcard 😂`;
  if (diffHours > 6) return `🔥 ${gwName} deadline in ${Math.floor(diffHours)} hours! Change your team or wallah you’ll regret it.`;
  if (diffHours > 2) return `⚡ ${gwName} deadline in ${Math.floor(diffHours)} hours! Yezzi t3ayet "inshallah later" 😂`;
  if (diffHours > 1) return `🚨 ${gwName} only 2 hours left! Bedel raw ya 9erd 🐒`;
  if (diffMinutes > 30) return `⚡ ${gwName} deadline in 1 hour! Ma3andek zhar if you forget.`;
  if (diffMinutes > 10) return `🔥 ${gwName} deadline in 30 minutes! Wake up ya khouya 😂`;
  return `🔥🔥 ${gwName} ONLY 10 MINUTES LEFT!! Bedel raw or your captain stays benched like 7amda fil café 😂`;
}

async function checkAndNotify() {
  const upcoming = await getNextDeadline();
  if (!upcoming) return;

  const deadline = new Date(upcoming.deadline_time);
  const now = new Date();
  const diffMinutes = (deadline - now) / 1000 / 60;

  if (diffMinutes <= 72 * 60) {
    const msg = formatMessage(diffMinutes, upcoming.name);
    await sendDiscordNotification(msg);
    console.log("Sent:", msg);
  }
}

let intervalId;

const notifications = {
  start() {
    console.log("🔔 FPL notifier started...");
    sendDiscordNotification("✅ Test notification – system working!");
    checkAndNotify();

    intervalId = setInterval(async () => {
      const upcoming = await getNextDeadline();
      if (!upcoming) return;

      const deadline = new Date(upcoming.deadline_time);
      const now = new Date();
      const diffMinutes = (deadline - now) / 1000 / 60;

      if (diffMinutes <= 60 && diffMinutes > 30) {
        checkAndNotify();
        setTimeout(checkAndNotify, 30 * 60 * 1000);
      } else if (diffMinutes <= 30) {
        checkAndNotify();
        setTimeout(checkAndNotify, 10 * 60 * 1000);
      } else {
        checkAndNotify();
      }
    }, 60 * 60 * 1000);
  },

  stop() {
    if (intervalId) {
      clearInterval(intervalId);
      console.log("🔕 Notifications stopped");
    }
  }
};

export default notifications;
