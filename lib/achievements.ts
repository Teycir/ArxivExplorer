/**
 * lib/achievements.ts
 * Roadmap Phase 5 — Achievement System (localStorage-only, zero cost).
 *
 * Tracks:
 *   - papers viewed (by paper ID)
 *   - topics explored
 *   - daily activity streak
 *
 * Awards badges:
 *   - "First Steps"     — read first paper
 *   - "Explorer"        — read 10 papers
 *   - "Deep Diver"      — read 50 papers
 *   - "Centurion"       — read 100 papers
 *   - "Topic Hopper"    — explored 5 topics
 *   - "Polymath"        — explored 10 topics
 *   - "Week Streak"     — 7-day reading streak
 *   - "Month Streak"    — 30-day reading streak
 *   - "Code Hunter"     — viewed 5 papers with code repos
 *   - "Benchmarker"     — viewed 5 benchmarked papers
 *   - "Influential Taste" — viewed 5 influential papers
 */

export interface AchievementEntry {
  id: string;
  label: string;
  description: string;
  icon: string;  // emoji
  unlockedAt?: number; // unix ms, undefined = locked
  tier: 'bronze' | 'silver' | 'gold';
}

export interface ActivityStore {
  papersViewed: string[];       // arXiv IDs (deduped)
  topicsExplored: string[];     // topic slugs (deduped)
  codeViewCount: number;        // papers with code that were viewed
  benchmarkViewCount: number;   // benchmarked papers viewed
  influentialViewCount: number; // influential papers viewed
  dailyDates: string[];         // ISO date strings YYYY-MM-DD (deduped, last 60 days)
  achievements: Record<string, number>; // id → unlockedAt ms
  lastUpdated: number;
}

const LS_KEY = 'arxiv_activity';

const ACHIEVEMENT_DEFS: AchievementEntry[] = [
  { id: 'first_paper',        label: 'First Steps',       description: 'Read your first paper',                icon: '📄', tier: 'bronze' },
  { id: 'ten_papers',         label: 'Explorer',           description: 'Read 10 papers',                       icon: '🔍', tier: 'bronze' },
  { id: 'fifty_papers',       label: 'Deep Diver',         description: 'Read 50 papers',                       icon: '🤿', tier: 'silver' },
  { id: 'hundred_papers',     label: 'Centurion',          description: 'Read 100 papers',                      icon: '💯', tier: 'gold'   },
  { id: 'five_topics',        label: 'Topic Hopper',       description: 'Explored 5 research topics',           icon: '🗺️', tier: 'bronze' },
  { id: 'ten_topics',         label: 'Polymath',           description: 'Explored 10 research topics',          icon: '🧠', tier: 'silver' },
  { id: 'week_streak',        label: 'Week Streak',        description: 'Read papers 7 days in a row',          icon: '🔥', tier: 'silver' },
  { id: 'month_streak',       label: 'Month Streak',       description: 'Read papers 30 days in a row',         icon: '⚡', tier: 'gold'   },
  { id: 'code_hunter',        label: 'Code Hunter',        description: 'Viewed 5 papers with code repos',      icon: '💻', tier: 'bronze' },
  { id: 'benchmarker',        label: 'Benchmarker',        description: 'Viewed 5 benchmarked papers',          icon: '📊', tier: 'bronze' },
  { id: 'influential_taste',  label: 'Influential Taste',  description: 'Viewed 5 influential papers',          icon: '⭐', tier: 'silver' },
];

// ─── Storage helpers ──────────────────────────────────────────────────────

function readStore(): ActivityStore {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? { ...emptyStore(), ...parsed } : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store: ActivityStore): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...store, lastUpdated: Date.now() }));
    window.dispatchEvent(new CustomEvent('arxiv:activity-changed'));
  } catch { /* storage full — silent */ }
}

function emptyStore(): ActivityStore {
  return {
    papersViewed: [], topicsExplored: [], codeViewCount: 0, benchmarkViewCount: 0,
    influentialViewCount: 0, dailyDates: [], achievements: {}, lastUpdated: 0,
  };
}

// ─── Streak calculation ────────────────────────────────────────────────────

function longestCurrentStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const sorted = [...new Set(dates)].sort().reverse();
  let streak = 0;
  let cursor = new Date().toISOString().slice(0, 10);

  for (const d of sorted) {
    if (d === cursor) {
      streak++;
      const prev = new Date(cursor);
      prev.setDate(prev.getDate() - 1);
      cursor = prev.toISOString().slice(0, 10);
    } else if (d < cursor) {
      break;
    }
  }
  return streak;
}

// ─── Unlock check ─────────────────────────────────────────────────────────

function checkUnlocks(store: ActivityStore): { store: ActivityStore; newBadges: string[] } {
  const streak  = longestCurrentStreak(store.dailyDates);
  const papers  = store.papersViewed.length;
  const topics  = store.topicsExplored.length;
  const newBadges: string[] = [];

  const conditions: Record<string, boolean> = {
    first_paper:       papers >= 1,
    ten_papers:        papers >= 10,
    fifty_papers:      papers >= 50,
    hundred_papers:    papers >= 100,
    five_topics:       topics >= 5,
    ten_topics:        topics >= 10,
    week_streak:       streak >= 7,
    month_streak:      streak >= 30,
    code_hunter:       store.codeViewCount >= 5,
    benchmarker:       store.benchmarkViewCount >= 5,
    influential_taste: store.influentialViewCount >= 5,
  };

  const updated = { ...store.achievements };
  for (const [id, met] of Object.entries(conditions)) {
    if (met && !updated[id]) {
      updated[id] = Date.now();
      newBadges.push(id);
    }
  }

  return { store: { ...store, achievements: updated }, newBadges };
}

// ─── Public API ────────────────────────────────────────────────────────────

export interface PaperViewMeta {
  hasCode: boolean;
  hasBenchmark: boolean;
  isInfluential: boolean; // influentialCitationCount >= 50
}

/** Call this when a paper is viewed. Returns newly-unlocked badge IDs. */
export function recordPaperView(paperId: string, meta: PaperViewMeta): string[] {
  const store = readStore();
  const today = new Date().toISOString().slice(0, 10);

  const updated: ActivityStore = {
    ...store,
    papersViewed:        store.papersViewed.includes(paperId) ? store.papersViewed : [...store.papersViewed, paperId],
    dailyDates:          store.dailyDates.includes(today) ? store.dailyDates : [...store.dailyDates.slice(-60), today],
    codeViewCount:       store.codeViewCount + (meta.hasCode ? 1 : 0),
    benchmarkViewCount:  store.benchmarkViewCount + (meta.hasBenchmark ? 1 : 0),
    influentialViewCount: store.influentialViewCount + (meta.isInfluential ? 1 : 0),
  };

  const { store: final, newBadges } = checkUnlocks(updated);
  writeStore(final);
  return newBadges;
}

/** Call this when a topic is visited. */
export function recordTopicView(slug: string): string[] {
  const store = readStore();
  if (store.topicsExplored.includes(slug)) return [];
  const updated = { ...store, topicsExplored: [...store.topicsExplored, slug] };
  const { store: final, newBadges } = checkUnlocks(updated);
  writeStore(final);
  return newBadges;
}

/** Get all achievements with lock/unlock status. */
export function getAchievements(): AchievementEntry[] {
  const store = readStore();
  return ACHIEVEMENT_DEFS.map(def => ({
    ...def,
    unlockedAt: store.achievements[def.id] ?? undefined,
  }));
}

/** Current streak + stats snapshot for display. */
export function getActivityStats() {
  const store = readStore();
  return {
    papersRead:  store.papersViewed.length,
    topicsVisited: store.topicsExplored.length,
    currentStreak: longestCurrentStreak(store.dailyDates),
    unlockedCount: Object.keys(store.achievements).length,
    totalBadges:   ACHIEVEMENT_DEFS.length,
  };
}
