# Search Filters - Complete Implementation

All filters are now fully wired from UI → API → Database.

## Available Filters

### 1. **Category Filter**
- **UI**: 12 category buttons (AI, ML, NLP, CV, Crypto, etc.)
- **Param**: `?category=cs.LG`
- **Backend**: Filters via `paper_categories` join

### 2. **Date Range Filter**
- **UI**: 4 date range buttons
- **Options**: `week`, `month`, `3months`, `year`
- **Param**: `?date=week`
- **Backend**: Filters on `published_at >= calculated_date`

### 3. **Paper Type Filter** ✨ NEW
- **UI**: 6 paper type buttons
- **Options**: `empirical`, `theoretical`, `survey`, `dataset`, `position`, `tutorial`
- **Param**: `?paperType=survey`
- **Backend**: Filters on `summaries.paper_type`

### 4. **Has Code Filter** ✨ NEW
- **UI**: Toggle button with code icon
- **Param**: `?hasCode=1`
- **Backend**: Filters on `code_count > 0`
- **Visual**: Green emerald color when active

### 5. **Open Access Filter** ✨ NEW
- **UI**: Toggle button with lock icon
- **Param**: `?openAccess=1`
- **Backend**: Filters on `is_open_access = 1`
- **Visual**: Sky blue color when active

### 6. **Author Filter**
- **UI**: Text input with Apply/Clear buttons
- **Param**: `?author=Hinton`
- **Backend**: Substring match on `authors` field

### 7. **Minimum Citations Filter**
- **UI**: Number input with Apply/Clear buttons
- **Param**: `?minCitations=10`
- **Backend**: Filters on `citation_count >= N`

## Filter Combinations

All filters work together and can be combined:

```
/search?q=transformer&author=Vaswani&minCitations=100&category=cs.LG&date=month&hasCode=1
```

## Cache Strategy

- Each filter combination gets a unique KV cache key
- Cache TTL: 2 hours
- Key format: `q:{normalized_query}:l{limit}:f:{filter1:filter2:...}`

## Active Filter Display

The search results page shows all active filters:
- Category name
- Date range label
- Author name
- "≥N citations"
- Paper type
- "has code"
- "open access"

## UI Location

All filters are in the `SearchFilters` component, accessible via the "Show Filters" button on `/search` page.

## Implementation Files Changed

1. **helper/api.ts**: Updated `searchPapers()` to accept all filter params
2. **app/search/page.tsx**: Updated to extract and pass all filters
3. **app/components/SearchFilters.tsx**: Already had all UI components

## Backend Support

All filters are already implemented in:
- `src/api-worker/routes/search.ts`: API endpoint
- `src/shared/db.ts`: Database queries with `SearchFilters` interface
