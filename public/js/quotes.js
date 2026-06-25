// ─────────────────────────────────────────────────────────────────────────────
//  quotes.js — inspirational movie quotes for the "day complete" celebration
//
//  getMovieQuote() tries a live movie-quote API first, then falls back to the
//  bundled list below if the API is unreachable / blocked / slow. Free,
//  movie-specific quote APIs are unreliable, so the bundle is the dependable
//  source and the API is a best-effort "live" layer.
//
//  To go bundled-only, set MOVIE_QUOTE_API_URL = null. Swap the URL for any
//  working movie-quote endpoint that returns a quote + source title; the parser
//  below is tolerant of common field names (quote/content/text, movie/show/title).
// ─────────────────────────────────────────────────────────────────────────────

// A movie/series-specific endpoint so the popup only ever shows MOVIE quotes
// (when this is unreachable we fall back to the bundled movie quotes, never to
// off-theme author quotes).
const MOVIE_QUOTE_API_URL = "https://movie-quote-api.herokuapp.com/v1/quote/";
const API_TIMEOUT_MS = 2500;

export const FALLBACK_QUOTES = [
  { text: "Why do we fall? So we can learn to pick ourselves up.", movie: "Batman Begins" },
  { text: "Just keep swimming.", movie: "Finding Nemo" },
  { text: "Hope is a good thing, maybe the best of things, and no good thing ever dies.", movie: "The Shawshank Redemption" },
  { text: "Adventure is out there!", movie: "Up" },
  { text: "Do, or do not. There is no try.", movie: "The Empire Strikes Back" },
  { text: "The flower that blooms in adversity is the most rare and beautiful of all.", movie: "Mulan" },
  { text: "It is our choices that show what we truly are, far more than our abilities.", movie: "Harry Potter and the Chamber of Secrets" },
  { text: "Our lives are defined by opportunities, even the ones we miss.", movie: "The Curious Case of Benjamin Button" },
  { text: "It's not who I am underneath, but what I do that defines me.", movie: "Batman Begins" },
  { text: "Life is like a box of chocolates. You never know what you're gonna get.", movie: "Forrest Gump" },
  { text: "You're braver than you believe, stronger than you seem, and smarter than you think.", movie: "Pooh's Grand Adventure" },
  { text: "Oh yes, the past can hurt. But the way I see it, you can either run from it or learn from it.", movie: "The Lion King" },
  { text: "All we have to decide is what to do with the time that is given us.", movie: "The Lord of the Rings" },
  { text: "Even the smallest person can change the course of the future.", movie: "The Lord of the Rings" },
  { text: "Today is a gift. That's why they call it the present.", movie: "Kung Fu Panda" },
  { text: "There is no charge for awesomeness, or attractiveness.", movie: "Kung Fu Panda" },
  { text: "The very things that hold you down are going to lift you up.", movie: "Dumbo" },
  { text: "Venture outside your comfort zone. The rewards are worth it.", movie: "Tangled" },
  { text: "A person who never made a mistake never tried anything new.", movie: "Meet the Robinsons" },
  { text: "Keep moving forward.", movie: "Meet the Robinsons" },
  { text: "Believe you can and you're halfway there.", movie: "Tomorrowland" },
  { text: "To infinity and beyond!", movie: "Toy Story" },
  { text: "The only way to do great work is to love what you do.", movie: "Jobs" },
  { text: "Carpe diem. Seize the day, boys. Make your lives extraordinary.", movie: "Dead Poets Society" },
  { text: "Get busy living, or get busy dying.", movie: "The Shawshank Redemption" },
  { text: "Why are you trying so hard to fit in when you were born to stand out?", movie: "What a Girl Wants" },
  { text: "It's the possibility of having a dream come true that makes life interesting.", movie: "The Alchemist" },
  { text: "You is kind. You is smart. You is important.", movie: "The Help" },
  { text: "Great men are not born great, they grow great.", movie: "The Godfather" },
  { text: "If you focus on what you left behind, you will never see what lies ahead.", movie: "Ratatouille" },
  { text: "Anyone can cook, but only the fearless can be great.", movie: "Ratatouille" },
  { text: "The past can hurt, but you can either run from it or learn from it.", movie: "The Lion King" },
  { text: "Sometimes the right path is not the easiest one.", movie: "Pocahontas" },
  { text: "You control your destiny — you don't need magic to do it.", movie: "Brave" },
  { text: "Our fate lives within us. You only have to be brave enough to see it.", movie: "Brave" },
  { text: "Always let your conscience be your guide.", movie: "Pinocchio" },
  { text: "The things that make me different are the things that make me.", movie: "Winnie the Pooh" },
  { text: "When life gets you down, you know what you gotta do? Just keep swimming.", movie: "Finding Nemo" },
  { text: "No matter how your heart is grieving, if you keep on believing, the dream that you wish will come true.", movie: "Cinderella" },
];

function randomFallback() {
  return FALLBACK_QUOTES[Math.floor(Math.random() * FALLBACK_QUOTES.length)];
}

// Best-effort parse of whatever the API returns into { text, movie }.
function parseApiResponse(data) {
  const item = Array.isArray(data) ? data[0] : data;
  if (!item) return null;
  const text = item.content || item.quote || item.text;
  const movie = item.movie || item.show || item.author || item.title;
  if (!text) return null;
  return { text: String(text), movie: movie ? String(movie) : "Unknown" };
}

export async function getMovieQuote() {
  if (!MOVIE_QUOTE_API_URL) return randomFallback();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(MOVIE_QUOTE_API_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseApiResponse(await res.json());
    return parsed || randomFallback();
  } catch {
    return randomFallback(); // network / CORS / timeout / bad shape
  } finally {
    clearTimeout(timer);
  }
}
