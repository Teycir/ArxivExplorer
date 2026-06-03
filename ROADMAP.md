# ArxivExplorer Feature Roadmap

**Last Updated:** 2026-06-03

This document tracks planned features and their implementation status. Check boxes as features are completed.

---

## 🚀 **Deployment & Testing Tracking**

### Documentation Created
- [x] `DEPLOYMENT.md` — Complete production deployment guide
- [x] `TESTING_GUIDE.md` — Comprehensive testing procedures
- [x] `test-integration-production.sh` — 12-test integration suite
- [x] `test-stress-production.sh` — Load/stress testing script
- [x] `pre-deploy-check.sh` — Pre-deployment validation
- [x] `VERIFICATION_CHECKLIST.md` — Manual QA checklist

### Deployment Checklist
- [x] Run `./pre-deploy-check.sh` — all checks pass
- [x] Deploy API Worker: `npm run deploy:api`
- [x] Deploy Ingest Worker: `npm run deploy:ingest`
- [x] Deploy Frontend: `npm run deploy`
- [x] Run `./test-integration-production.sh` — all tests pass
- [ ] Run `./test-stress-production.sh` — performance acceptable
- [ ] Monitor for 24 hours (Cloudflare analytics)
- [ ] Update README.md with screenshots
- [ ] Tag release: `git tag v1.1.0 && git push --tags`

---

## 🎯 **Phase 1: Zero-Cost Quality Signals** (Week 1)

### Paper Quality Indicators
- [x] **Quality Badges** (#15)
  - [x] Add badge component system to `PaperCard.tsx` (`QualityBadges.tsx`)
  - [x] Implement badges: Code Available, Open Access, Influential (50+ cites)
  - [x] Add: Comprehensive (100+ refs), Benchmarked, Recent (<6mo)
  - [x] Update UI to show badges on search/trending pages
  - [ ] Add filter: "Show only papers with code" (search filter already exists via `hasCode` param)

### Researcher Profiles
- [x] **Auto-Generated Author Pages** (#6)
  - [x] Create `/author/[name]/page.tsx` route *(was already present, now enhanced)*
  - [x] Implement `GET /api/author/:name` endpoint *(enhanced with stats)*
  - [x] Build author stats aggregation (total papers, citations, categories)
  - [x] Extract co-author network from existing data
  - [x] Add author card component with timeline graph (`AuthorStatsPanel.tsx`)
  - [x] Implement KV caching (7-day TTL) *(6h already; bumped to match roadmap)*
  - [x] Add "View Author" link on paper cards *(already existed via AuthorLinks)*

---

## 🗺️ **Phase 2: Visualization & Discovery** (Week 2)

### Semantic Clustering
- [ ] **Interactive Research Map** (#9)
  - [ ] Write `scripts/generate-clusters.py` (UMAP + HDBSCAN)
  - [ ] Export to `public/data/paper-clusters.json` (static file)
  - [ ] Create `/explore/page.tsx` with Plotly.js scatter plot
  - [ ] Implement cluster labeling (auto-name clusters by top keywords)
  - [ ] Add zoom/pan interactions
  - [ ] Add filter: "Show only my bookmarks on map"
  - [ ] Set up weekly cron to regenerate clusters

### Citation Network
- [ ] **Paper Dependency Graph** (#8)
  - [ ] Create `GET /api/graph/:id` endpoint (uses `related_papers`)
  - [ ] Build D3.js force-directed graph component
  - [ ] Add to paper detail page as "Related Network" tab
  - [ ] Implement expand/collapse nodes (fetch related-of-related)
  - [ ] Add color coding by category
  - [ ] Export graph as PNG/SVG

---

## 📚 **Phase 3: Learning & Collaboration** (Week 3)

### Paper Playlists
- [ ] **Curated Learning Paths** (#3 - adapted)
  - [ ] Design playlist schema (limit 20 papers/playlist to control D1)
  - [ ] Create `playlists` and `playlist_papers` tables
  - [ ] Implement `GET/POST /api/playlists` endpoints
  - [ ] Build playlist creator UI (`/playlists/new`)
  - [ ] Add fork/remix functionality
  - [ ] Track user progress (localStorage initially, D1 if needed)
  - [ ] Add playlist discovery page (`/playlists/trending`)
  - [ ] Implement share links

### Skill Ladder
- [x] **Prerequisite Chains** (#3 concept)
  - [x] Add "Prerequisites" section to paper detail page (`SkillLadder.tsx`)
  - [x] Use existing `summary.prerequisites` field
  - [x] Create interactive tree: "To understand X, read A→B→C first"
  - [x] Add progress tracker: "2/5 prerequisites completed" (localStorage)
  - [ ] Badge system: "Mastered Transformers" (read 10+ papers) — deferred to Phase 5

---

## 🔄 **Phase 4: Version Control & Comparison** (Week 4)

### Paper Diff Tool
- [ ] **Version Comparison** (#5)
  - [ ] Create `GET /api/diff?v1=...&v2=...` endpoint
  - [ ] Implement arXiv text extraction (use plain-text export)
  - [ ] Integrate `diff-match-patch` library
  - [ ] Build side-by-side diff viewer component
  - [ ] Add to paper detail page: "View Changes" button
  - [ ] Implement KV caching (permanent - versions immutable)
  - [ ] Add support for abstract-only diff (faster)

### Enhanced Comparison
- [x] **Multi-Paper Matrix** (existing `/compare` enhancement)
  - [x] Expand to 6-paper side-by-side (was 4)
  - [x] Add table export (CSV/Markdown)
  - [x] Implement field selector: "Compare only Methods + Results"
  - [ ] Add "Generate summary table" (no LLM - template-based)

---

## 🎮 **Phase 5: Gamification & Engagement** (Week 5)

### Research Streaks
- [x] **Achievement System** (#12)
  - [x] Create `user_activity` store (localStorage — `lib/achievements.ts`)
  - [x] Track: papers read, days active, topics explored, code/benchmark/influential views
  - [x] Build achievement badges: "Week Streak", "100 Papers", "10 Topics", and 8 more
  - [x] Add `/achievements` page with badge grid + stats
  - [x] Show toast notification when badge unlocked (`AchievementToast.tsx`)
  - [x] Show Navbar link 🏆 to achievements
  - [ ] Leaderboard page (`/leaderboards`) — deferred (requires backend)
  - [ ] Weekly digest email with stats — deferred (requires email infra)

### Prediction Markets
- [ ] **Citation Forecasting Game** (#4)
  - [ ] Create `predictions` table (virtual currency only)
  - [ ] Build prediction UI: "Will this reach 100 cites by 2027?"
  - [ ] Implement points system (accuracy rewards)
  - [ ] Add leaderboard: "Top Predictors"
  - [ ] Cron job: resolve predictions monthly
  - [ ] Show prediction consensus on paper cards

---

## ✍️ **Phase 6: Community Features** (Week 6)

### Annotations Layer
- [ ] **Public Paper Markup** (#2)
  - [ ] Create `annotations` table
  - [ ] Implement highlight-to-annotate UI on paper detail page
  - [ ] Add upvote/downvote system
  - [ ] Build moderation queue (flag inappropriate)
  - [ ] Show top annotations by default
  - [ ] Add filter: "Show only verified annotations"

### Reading Clubs
- [ ] **Paper Discussion Groups** (#1)
  - [ ] Create `clubs`, `club_papers`, `club_posts` tables
  - [ ] Build club creation UI (`/clubs/new`)
  - [ ] Implement weekly paper schedule
  - [ ] Add discussion threads per paper
  - [ ] Email digest: "This week's paper in your club"
  - [ ] Leaderboard: most active clubs

---

## 🔔 **Phase 7: Notifications & Alerts** (Week 7)

### Citation Tracking
- [ ] **Paper Citation Alerts** (#10)
  - [ ] Implement Semantic Scholar API poller (daily batch)
  - [ ] Create `citation_alerts` table
  - [ ] Add "Watch for citations" button on papers
  - [ ] Build Web Push notification system
  - [ ] Email digest: "3 of your bookmarks were cited this week"
  - [ ] Show citation history graph on paper detail

### Personalized Digest
- [ ] **Weekly Research Summary** (#7)
  - [ ] Build email template (no LLM - just listing)
  - [ ] Cloudflare Email Workers integration
  - [ ] User preferences: topics, frequency
  - [ ] Digest content: new papers in bookmarked categories
  - [ ] Add unsubscribe/preferences link

---

## 🧠 **Phase 8: Advanced Discovery** (Week 8)

### Timeline Reconstruction
- [ ] **Research Lineage Trees** (#1 from original)
  - [ ] Build citation chain detector (parse references)
  - [ ] Create `/timeline/:concept` route
  - [ ] Visualize chronological paper evolution
  - [ ] Add narrative: "Paper X influenced Y, led to Z"
  - [ ] Interactive tree: click node → expand influences

### Semantic Code Search
- [ ] **Architecture-Aware Search** (#10 from original)
  - [ ] Index code patterns from repos (GitHub API)
  - [ ] Create `code_patterns` table
  - [ ] Implement queries: "LoRA with rank<8", "Transformers with <100M params"
  - [ ] Add to main search: "Has attention mechanism: custom"

---

## 🎨 **Phase 9: Content Remixing** (Week 9)

### Multiple Explanation Styles
- [ ] **Paper Remixer** (#5 from original)
  - [ ] Create `/paper/:id/remix` route
  - [ ] Static templates (no LLM): ELI5, Tweet Thread, Haiku
  - [ ] Add user-submitted remixes (community-driven)
  - [ ] Voting system for best remixes
  - [ ] Featured remix on homepage weekly

### Paper Podcasts
- [ ] **Audio Summaries** (#11 from original)
  - [ ] Generate conversational scripts (template-based)
  - [ ] Integrate Cloudflare TTS or browser Web Speech API
  - [ ] Add "Listen" button on paper detail
  - [ ] Cache audio files (MP3 in R2 bucket)
  - [ ] Podcast RSS feed option

---

## 🏆 **Phase 10: Advanced Analytics** (Week 10)

### Impact Prediction
- [ ] **Citation Forecast Model** (#6 from original)
  - [ ] Train model on historical data (local, export predictions)
  - [ ] Add "Predicted Impact Score" to papers
  - [ ] Create `/trending/predicted` page
  - [ ] Flag "hidden gems" (low current, high predicted)
  - [ ] Weekly email: "Papers likely to trend"

### Collaboration Network
- [ ] **Social Research Graph** (#7 from original)
  - [ ] Build co-authorship graph from papers table
  - [ ] Create `/graph/network/:author` route
  - [ ] Detect research clusters (tightly connected groups)
  - [ ] Recommend: "You'd like researcher X (bridges A & B)"
  - [ ] Show collaboration heatmap over time

---

## 🛠️ **Ongoing Maintenance**

### Infrastructure
- [ ] Set up monitoring (Cloudflare Analytics)
- [ ] Add Sentry error tracking
- [ ] Implement rate limiting (per-IP)
- [ ] Add sitemap.xml generation for author/topic pages
- [ ] Set up automated backups (D1 → R2)

### Content Quality
- [ ] Moderation dashboard for annotations/clubs
- [ ] Automated spam detection (simple keyword filter)
- [ ] User reporting system
- [ ] Content policy page

### Performance
- [ ] Add service worker for offline access
- [ ] Implement aggressive KV caching strategy review
- [ ] Optimize D1 queries (add indexes where needed)
- [ ] Set up CDN for static assets

---

## 📊 **Success Metrics**

Track these KPIs to measure feature impact:

- [ ] Daily Active Users (DAU)
- [ ] Average papers viewed per session
- [ ] Bookmark → Return rate
- [ ] Playlist creation rate
- [ ] Annotation engagement rate
- [ ] Club activity (posts per week)
- [ ] Citation alert click-through rate
- [ ] Email digest open rate

---

## 🚀 **Launch Checklist**

Before each phase goes live:

- [ ] Feature tested locally
- [ ] Added to integration test suite
- [ ] Documentation updated
- [ ] Announcement drafted
- [ ] Analytics events added
- [ ] Rollback plan documented
- [ ] Load testing completed (if applicable)

---

## 📝 **Notes**

- All features maintain free-tier compatibility
- LLM usage avoided except where explicitly marked
- D1 row limits respected (playlists capped at 20 papers)
- KV cache strategy: permanent for immutable data, 7-day for aggregations
- Features marked with ⚠️ need community moderation

---

**Progress:** ~30 / 150+ items completed

**Next Milestone:** Phase 2 — Visualization & Discovery (paper clusters, citation graph)
