/**
 * الإنجازات المدمجة. كل سيرفر يحصل عليها تلقائيًا ويستطيع تعطيل أي منها
 * أو تعديل مكافأتها، ويضيف إنجازاته الخاصة على نفس المقاييس.
 *
 * المقاييس (metric) المدعومة وما يغذّيها:
 *  messages, voice_minutes, level (الأعلى), xp, games_played, games_won,
 *  tickets_opened, tickets_closed, suggestions, suggestions_accepted,
 *  daily_streak (الأعلى), shop_purchases, balance (قيمة لحظية), staff_promotions, active_days
 */
const METRICS = {
  messages: { category: "messages", mode: "sum" },
  voice_minutes: { category: "voice", mode: "sum" },
  active_days: { category: "activity", mode: "sum" },
  level: { category: "xp", mode: "max" },
  xp: { category: "xp", mode: "sum" },
  balance: { category: "economy", mode: "max" },
  daily_streak: { category: "economy", mode: "max" },
  shop_purchases: { category: "economy", mode: "sum" },
  tickets_opened: { category: "tickets", mode: "sum" },
  tickets_closed: { category: "staff", mode: "sum" },
  staff_promotions: { category: "staff", mode: "sum" },
  games_played: { category: "games", mode: "sum" },
  games_won: { category: "games", mode: "sum" },
  suggestions: { category: "suggestions", mode: "sum" },
  suggestions_accepted: { category: "suggestions", mode: "sum" }
};

const BUILTINS = [
  { key: "first_words", name: "أول الكلمات", emoji: "💬", metric: "messages", target: 1, reward: { xp: 10 } },
  { key: "chatter_100", name: "متحدث", emoji: "🗣️", metric: "messages", target: 100, reward: { money: 500 } },
  { key: "chatter_1000", name: "صوت السيرفر", emoji: "📣", metric: "messages", target: 1000, reward: { money: 3000, xp: 200 } },
  { key: "chatter_10000", name: "أسطورة الدردشة", emoji: "👑", metric: "messages", target: 10000, reward: { money: 20000 }, hidden: true },
  { key: "voice_60", name: "صوت حاضر", emoji: "🎙️", metric: "voice_minutes", target: 60, reward: { xp: 50 } },
  { key: "voice_1000", name: "ساكن الرومات", emoji: "🎧", metric: "voice_minutes", target: 1000, reward: { money: 5000 } },
  { key: "regular_7", name: "منتظم", emoji: "📅", metric: "active_days", target: 7, reward: { money: 700 } },
  { key: "regular_30", name: "من أهل البيت", emoji: "🏠", metric: "active_days", target: 30, reward: { money: 5000, xp: 300 } },
  { key: "level_5", name: "صاعد", emoji: "⭐", metric: "level", target: 5, reward: { money: 1000 } },
  { key: "level_20", name: "محترف", emoji: "🌟", metric: "level", target: 20, reward: { money: 10000 } },
  { key: "level_50", name: "نخبة", emoji: "💫", metric: "level", target: 50, reward: { money: 50000 }, hidden: true },
  { key: "rich_10k", name: "مرتاح ماديًا", emoji: "💰", metric: "balance", target: 10000, reward: { xp: 100 } },
  { key: "rich_1m", name: "مليونير", emoji: "🤑", metric: "balance", target: 1000000, reward: { xp: 2000 }, hidden: true },
  { key: "streak_7", name: "أسبوع كامل", emoji: "🔥", metric: "daily_streak", target: 7, reward: { money: 2000 } },
  { key: "shopper", name: "متسوّق", emoji: "🛍️", metric: "shop_purchases", target: 5, reward: { xp: 100 } },
  { key: "ticket_first", name: "طلب المساعدة", emoji: "🎫", metric: "tickets_opened", target: 1, reward: { xp: 10 } },
  { key: "staff_closer_50", name: "حلّال المشاكل", emoji: "🛠️", metric: "tickets_closed", target: 50, reward: { money: 10000 } },
  { key: "gamer_10", name: "لاعب", emoji: "🎮", metric: "games_played", target: 10, reward: { money: 500 } },
  { key: "winner_50", name: "محظوظ", emoji: "🍀", metric: "games_won", target: 50, reward: { money: 5000 } },
  { key: "ideas_5", name: "صاحب أفكار", emoji: "💡", metric: "suggestions", target: 5, reward: { xp: 150 } },
  { key: "idea_accepted", name: "فكرة معتمدة", emoji: "✅", metric: "suggestions_accepted", target: 1, reward: { money: 2000 } }
].map((a) => ({ ...a, category: METRICS[a.metric].category, hidden: !!a.hidden, builtin: true }));

module.exports = { METRICS, BUILTINS };
