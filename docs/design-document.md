# Little Missy's Board — Design Document

**Version:** v4 (search + file upload)
**Type:** Single-page web application (standalone HTML)
**Status:** Deployed via GitHub Pages

---

## 1. Overview

### 1.1 Purpose

Little Missy's Board is a lightweight, mobile-first family calendar built to solve one specific problem: school communication arrives as noisy, unstructured input (emails, photographed notices, PDF newsletters, worksheets) and needs to become structured, shared, glanceable information — dated calendar entries, standing notices, and a day-by-day homework record — with minimal manual data entry.

### 1.2 Target users

- **Primary users:** two parents (a household of two) who both need to see and add to the same data.
- **Usage context:** mobile-first, occasional bursts of input (after checking email or picking up a physical notice) followed by glancing lookups ("what's on this week," "what's homework today").

### 1.3 Core value proposition

Instead of manually typing calendar entries, the user pastes an email or photographs a notice/worksheet/PDF, and an AI model (Claude, via the Anthropic API) reads it and proposes structured entries — which the user reviews and confirms before anything is saved.

### 1.4 Non-goals

- Not a general-purpose calendar app (no recurring events, no multiple calendars, no invites).
- Not a multi-family or multi-tenant product — one shared board per deployment.
- Not real-time collaborative (no live cursors/presence) — sync is near-real-time via polling.
- No user accounts or login — access is controlled only by who has the URL and (implicitly) the Firestore project ID.

---

## 2. Information Architecture

The app is a single HTML page with client-side view switching (no routing/URLs per screen). Navigation is a fixed bottom tab bar with four destinations, plus a header-level search overlay that can appear over any tab.

```
┌─────────────────────────────┐
│ Header: logo + date + title │
│         + search toggle     │
├─────────────────────────────┤
│                              │
│   Active tab content         │
│   (or search results         │
│    overlay when searching)   │
│                              │
├─────────────────────────────┤
│ [Calendar][Notices][Homework][Add] │
└─────────────────────────────┘
```

| Tab | Purpose |
|---|---|
| **Calendar** | Default view. Month grid + selected day's events and homework. |
| **Notices** | Flat list of all standing notices (homework reminders, permission slips, info, general reminders) not tied to a specific attendance date. |
| **Homework** | Chronological log of all homework entries across all dates, most recent first. |
| **Add** | Capture screen — paste text, upload photo/PDF, or log homework, followed by an AI-generated draft review step. |

Search is not a tab; it's a header-toggled overlay that replaces the current tab's content with a unified result list across events, notices, and homework, without navigating away from wherever the user was.

---

## 3. Data Model

All data lives in three flat arrays in application state, and is mirrored to a single Firestore document for sharing/persistence (see §8).

### 3.1 Event

```json
{
  "id": "1699999999.123",
  "type": "event",
  "title": "Sports Day",
  "date": "2026-09-18",
  "time": "9:30 AM",
  "location": "Main school ground",
  "category": "School"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string/number | `Date.now() + Math.random()` at creation time |
| `type` | `"event"` | Fixed literal, used for routing/filtering |
| `title` | string | Required |
| `date` | string `YYYY-MM-DD` | Required — drives calendar placement |
| `time` | string | Free text (e.g. "9:30 AM"), optional |
| `location` | string | Optional |
| `category` | enum | `School` \| `Activity` \| `Reminder` \| `Other` |

### 3.2 Notice

```json
{
  "id": "1699999999.456",
  "type": "notice",
  "title": "Field trip permission slip",
  "summary": "Sign and return the permission slip for the museum trip.",
  "dueDate": "2026-09-17",
  "category": "Permission Slip"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string/number | Same generation scheme as events |
| `type` | `"notice"` | Fixed literal |
| `title` | string | Required |
| `summary` | string | One-sentence description, optional |
| `dueDate` | string `YYYY-MM-DD` or `""` | Optional — notices are not required to have a date |
| `category` | enum | `Homework` \| `Permission Slip` \| `Info` \| `Reminder` |

### 3.3 Homework log entry

```json
{
  "id": "1699999999.789",
  "type": "homework",
  "title": "Math worksheet",
  "summary": "Pages 12–14, plus a short reading log entry.",
  "date": "2026-09-15"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string/number | Same generation scheme |
| `type` | `"homework"` | Fixed literal |
| `title` | string | Subject or worksheet name |
| `summary` | string | 1–2 sentence description |
| `date` | string `YYYY-MM-DD` | **The date the homework is FOR** (due/assigned day) — resolved by the AI from the source material, defaulting to today only if no date is determinable |

**Design note:** homework entries were deliberately changed from "date logged" (defaulting to today) to "date the homework is for," so that homework appears on the correct day in the Calendar tab's day view rather than clustering under whatever day it happened to be photographed.

### 3.4 Draft (transient, pre-confirmation)

Before anything is saved, extraction results are held as drafts — the same shapes as above but with a temporary `_id` (not `id`) and no guarantee all fields are filled in; the user edits these inline before confirming.

---

## 4. Application State

All state lives in a single top-level component (`SchoolCalendarApp`). No external state management library is used.

| State variable | Type | Purpose |
|---|---|---|
| `tab` | string | Active bottom-nav tab: `"agenda"` (Calendar), `"notices"`, `"homework"`, `"add"` |
| `events` | Event[] | All confirmed events |
| `notices` | Notice[] | All confirmed notices |
| `homeworkLog` | HomeworkEntry[] | All confirmed homework entries |
| `mode` | string | Active capture mode in the Add tab: `"text"` \| `"photo"` \| `"homework"` |
| `pastedText` | string | Text-mode input buffer |
| `images` | `{file, isPdf, preview}[]` | Selected files for photo/homework mode (images and/or PDFs) |
| `loading` | boolean | Extraction in progress |
| `error` | string | Current inline error message, if any |
| `drafts` | array \| null | Pending AI-extracted items awaiting review, or `null` when not in review |
| `currentMonth` | Date | The month currently displayed in the calendar grid |
| `selectedDate` | string `YYYY-MM-DD` | The day currently selected/expanded below the calendar grid |
| `searchOpen` | boolean | Whether the search input/overlay is visible |
| `searchQuery` | string | Current search text |
| `fileInputRef` | ref | Hidden `<input type="file">` element reference |

---

## 5. Core Flows

### 5.1 Capture → AI Extraction → Draft Review → Confirm

This is the primary flow of the app, used identically for events/notices (general mode) and homework (homework mode).

1. User selects a mode in the **Add** tab: Paste text / Upload photo / Log homework.
2. User provides input:
   - **Text mode:** free-text paste into a textarea (with a "Try a sample email" shortcut for demos).
   - **Photo/homework mode:** one or more files via a hidden `<input type="file" accept="image/*,application/pdf" multiple>`, rendered as a thumbnail grid (image previews, or a labeled file tile for PDFs).
3. On tapping **Extract**:
   - Each file is converted to base64 (`fileToBase64`).
   - Images become `{ type: "image", source: { type: "base64", media_type, data } }` blocks.
   - PDFs become `{ type: "document", source: { type: "base64", media_type: "application/pdf", data } }` blocks.
   - Text becomes a single `{ type: "text", text }` block.
   - All blocks from a single capture are sent together in **one** API call, so multi-page material is read as one coherent source.
4. `callClaude(blocks, mode)` sends the request (see §6 for prompt details) and parses the JSON response into an array of raw items.
5. Raw items are converted into **drafts**:
   - General mode: each item already carries `type: "event"` or `type: "notice"` from the model's own output.
   - Homework mode: every item is wrapped as `type: "homework"`, using the model-provided `date` (or today, as a fallback).
6. Drafts are rendered as editable cards — one per extracted item, with a colored badge (Event/Notice/Homework) and type-appropriate fields (event: title/date/time/location/category; notice: title/summary/due date/category; homework: title/summary/date). Any draft can be discarded individually before confirming.
7. On **Add** (confirm):
   - Drafts are split by `type` into three new arrays.
   - Events are merged into `events` and re-sorted by date+time.
   - Notices are prepended to `notices` (newest first).
   - Homework is prepended to `homeworkLog`.
   - The combined result is written both to local state and to the shared Firestore document (`persist()`, see §5.3).
   - The user is navigated to whichever tab has new content (Homework > Notices > Calendar, in that priority).

### 5.2 Calendar Day View

- The **Calendar** tab shows a month grid (see §7.4 for rendering details) plus, below it, everything for the currently **selected** day: matching events and matching homework entries side by side, each with its own delete control.
- Tapping any day cell sets `selectedDate` and re-renders the list below — no page transition, just a state update.
- Days with entries show small colored dots under the day number: up to two event-category dots plus one red dot if homework exists that day, so density is visible at a glance without opening each day.
- If a day has neither events nor homework, a single friendly empty state is shown ("Nothing for this day yet.").

### 5.3 Sync Flow (Load / Save / Poll)

- **On mount:** `loadSharedState()` fetches the shared Firestore document and, if present, overwrites local `events`/`notices`/`homeworkLog` with the remote copy.
- **Every 8 seconds:** the same fetch repeats via `setInterval`, so a second device's changes appear within roughly 8 seconds without any manual refresh.
- **On every mutation** (confirming drafts, deleting an event/notice/homework entry): the change goes through a single `persist(nextEvents, nextNotices, nextHomework)` helper, which updates local state immediately (optimistic UI) and fires `saveSharedState()` in the background.
- Both load and save are wrapped in `try/catch` and fail silently — if Firestore is unreachable (offline, misconfigured, or the project ID is blank), the app continues to work as a local-only, in-memory tool with no user-facing error. This was a deliberate resilience choice: sync is a bonus layer, not a hard dependency for the app to function.

### 5.4 Search Flow

- Tapping the header's magnifying glass toggles `searchOpen`; a text input appears under the header.
- As the user types, `searchResults` is computed inline (no debounce, no memoization — the dataset is small enough that this is cheap) by:
  1. Filtering `events` where `title` or `location` contains the query (case-insensitive).
  2. Filtering `notices` where `title` or `summary` contains the query.
  3. Filtering `homeworkLog` where `title` or `summary` contains the query.
  4. Tagging each match with its `kind` (`event`/`notice`/`homework`) and merging all three into one list, sorted by date.
- While searching, the search results list **replaces** the active tab's content entirely (an overlay pattern, not a new screen).
- Tapping a result:
  - **Event or homework result:** calls `jumpToDate(date)`, which sets `currentMonth` to that entry's month, sets `selectedDate` to that exact day, switches to the Calendar tab, and closes search — landing the user exactly where that item lives.
  - **Notice result:** switches to the Notices tab (notices aren't date-anchored on the calendar) and closes search.

---

## 6. AI Extraction Design

### 6.1 Model & endpoint

- **Model:** Claude Sonnet 4.6 (`claude-sonnet-4-6`), via the Anthropic Messages API (`POST /v1/messages`, `max_tokens: 1000`).
- **Routing:** requests go to `PROXY_URL` if set (a Cloudflare Worker, see §7.3), falling back to `https://api.anthropic.com/v1/messages` directly (used only when testing inside Claude's own artifact-preview sandbox, which has special first-party access to that endpoint).

### 6.2 Prompt design — General mode (events + notices)

Used for text-mode and photo-mode captures that aren't tagged as homework. Full system note (dynamically includes the current date):

> *Today's date is {today}. Read the provided content (which may include multiple photos, e.g. several pages of a newsletter or a few separate flyers — treat them all as one source and de-duplicate anything referring to the same thing). Pull out two kinds of items:*
> *1. EVENTS — anything with a specific date/time to attend or do something (e.g. Sports Day, Picture Day, a school trip).*
> *2. NOTICES — anything informational that isn't itself a dated thing to attend: homework, permission slips, supply requests, general announcements, reminders to bring/send something, or any other detail a parent should remember. If in doubt about whether something is a notice, include it as one — it's better to surface it than miss it.*
> *Resolve relative dates ("this Friday", "next Tuesday", "due Monday") against today's date.*
> *Respond with ONLY a JSON array (no markdown, no prose). Each item must have a "type" field of "event" or "notice".*
> *Event shape: `{"type": "event", "title": string, "date": "YYYY-MM-DD", "time": "HH:MM AM/PM or empty string", "location": string, "category": "School" | "Activity" | "Reminder" | "Other"}`*
> *Notice shape: `{"type": "notice", "title": string, "summary": string (one short sentence), "dueDate": "YYYY-MM-DD or empty string", "category": "Homework" | "Permission Slip" | "Info" | "Reminder"}`*
> *If an event has no determinable date, omit it. Return every distinct event and notice you find.*

### 6.3 Prompt design — Homework mode

Used only when the user explicitly selects "Log homework" as the capture mode:

> *Today's date is {today}. Look at the provided homework material (a photo of a worksheet/assignment, or pasted text describing homework). Identify each distinct homework item. For each, write a short title (subject or worksheet name), a one-to-two sentence summary of what it involves, and figure out which specific day this homework is FOR — meaning the day it's due, or if no due date is stated, the day it was assigned/given (e.g. if it says "today's homework" or the photo appears to be from a specific day, use that; resolve relative phrases like "due Monday" or "for tomorrow" against today's date). If truly no date can be determined, use today's date. Respond with ONLY a JSON array of objects: `{"title": string, "summary": string, "date": "YYYY-MM-DD"}`. If only one homework item is present, return an array with a single object.*

### 6.4 Multi-file handling

- Multiple images and/or PDFs from a single capture are sent as separate content blocks **within one message**, alongside the single system-note text block — not as separate API calls. This lets the model treat, for example, three photos of the same multi-page newsletter as one coherent source and avoid emitting duplicate entries for content that spans pages.

### 6.5 Response parsing

- The model is instructed to return **only** a raw JSON array, but the parser is defensive against minor deviations:
  1. Strip any accidental ` ```json ` / ` ``` ` code fences.
  2. Locate the first `[` and last `]` in the cleaned text and slice to that range, discarding any stray prose the model might prepend or append.
  3. `JSON.parse` the result.
  4. If the result isn't an array (e.g. a single bare object), wrap it in one.
- Any failure in this pipeline (network error, malformed JSON) surfaces as a friendly inline error: *"Something went wrong reading that. Try again, or enter the event manually."*

---

## 7. Technical Architecture

### 7.1 Two parallel codebases

The app exists in two forms that share nearly identical component logic:

| File | Purpose | Icon source | Module system |
|---|---|---|---|
| `school-calendar.jsx` | Source component for a future real Vite/npm build; also the version that renders live inside Claude's own chat interface for rapid iteration/testing | `lucide-react` npm package | ES modules (`import`/`export`) |
| `school-calendar.html` (deployed as `index.html`) | The actual shipped, standalone artifact | Hand-rolled local components (emoji-based for decorative icons, small inline SVGs for interactive ones like Plus/Check/X/Chevrons) | None — plain global scripts |

**Why two versions:** early attempts to run the ES-module version directly in a browser via `file://` hit two separate failure modes — `Cannot use import.meta outside a module` and a module-loader/iframe conflict with a browser extension — both stemming from ES modules being fragile outside a proper build pipeline or web server. The standalone version was rewritten to use classic global `<script>` tags (no `import`/`export` anywhere) specifically for reliability when opened directly by a non-technical user, at the cost of needing a duplicated icon set.

### 7.2 Standalone HTML runtime

No build step, no `npm install`. Everything loads from CDNs at request time:

- **React 18** and **ReactDOM 18**, development UMD builds, via unpkg (`react.development.js`, `react-dom.development.js`).
- **Babel Standalone**, which transforms JSX in the browser at page-load time. A custom preset is explicitly registered to force the **classic** JSX runtime (`Babel.registerPreset("react-classic", () => ({ plugins: [[Babel.availablePlugins["transform-react-jsx"], { runtime: "classic" }]] }))`), rather than relying on `@babel/preset-react`'s default — this was a deliberate fix after an earlier version's automatic-runtime detection tried to resolve a bare `react/jsx-runtime` module specifier, which browsers can't do without an import map.
- **Tailwind CSS**, via the `cdn.tailwindcss.com` play script (full JIT compiler running client-side; console will show its standard "not for production" warning, which is an accepted trade-off for a no-build personal tool).
- **Google Fonts** (Playfair Display, Nunito), loaded via an `@import` inside an inline `<style>` tag.

### 7.3 AI request routing (Cloudflare Worker proxy)

Browsers cannot call `api.anthropic.com` directly with a secret key safely — anything in client-side code is visible to anyone who opens dev tools. A small Cloudflare Worker (`cloudflare-worker.js`) sits between the app and Anthropic:

```
Browser → Cloudflare Worker (holds ANTHROPIC_API_KEY as an encrypted secret) → api.anthropic.com → back to browser
```

- The Worker accepts `POST` requests, forwards the raw body to Anthropic with the secret key attached server-side (`x-api-key` header), and returns the response with permissive CORS headers so the deployed GitHub Pages site can call it cross-origin.
- The app's `PROXY_URL` constant points at this Worker's URL; if left blank, the app falls back to calling Anthropic directly (which only succeeds inside Claude's own sandboxed testing environment).

### 7.4 Calendar month-grid rendering

`buildMonthMatrix(monthDate)` is a pure function (no component state) that:
1. Computes the weekday index of the 1st of the month (`Date.getDay()`, 0 = Sunday).
2. Pads the front of a flat cell array with `null` placeholders for the leading blank days.
3. Appends one `{ day, iso }` object per actual day of the month.
4. Pads the end with more `null`s until the total length is a multiple of 7.
5. Chunks the flat array into week-sized rows of 7 for rendering as a `grid-cols-7` grid.

Each day cell is a button showing the day number, a highlight state (filled terracotta if selected, tinted if today, plain otherwise), and up to three small dots summarizing that day's content (event category colors, plus a fixed red dot if homework exists).

### 7.5 Shared persistence (Firebase Firestore, REST-only)

No Firebase SDK is used — all communication is plain `fetch()` against Firestore's REST API, keeping the standalone file dependency-free:

- **Read:** `GET https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/(default)/documents/family_data/board`
- **Write:** `PATCH .../family_data/board?updateMask.fieldPaths=data` with body `{ "fields": { "data": { "stringValue": "<JSON string of the whole app state>" } } }`

The entire app state (`{ events, notices, homeworkLog }`) is serialized into **one** Firestore string field on **one** document, rather than modeled as separate typed Firestore documents/collections per entry. This trades Firestore's native querying/typing away in exchange for a drastically simpler client (one GET, one PATCH, no per-field type marshaling) — appropriate for a dataset this small (a single family's calendar).

### 7.6 Deployment model

Because the standalone file has no build step, deployment is: upload the file to a GitHub repository as `index.html`, then enable GitHub Pages ("Deploy from a branch," root folder). The live site is a static file server; all "backend" behavior (AI calls, data storage) happens via the two external services described above (Cloudflare Worker, Firestore), not via anything hosted alongside the HTML file itself.

---

## 8. Visual Design System

### 8.1 Theme

A warm, "boho" aesthetic: terracotta and mustard on a cream/amber gradient background, dashed "stitched-edge" borders, soft rounded corners, and a small flower icon in the header.

### 8.2 Color palette

| Role | Tailwind class(es) | Approx. hex | Used for |
|---|---|---|---|
| Primary accent | `orange-700` | `#c2410c` | Header icon badge, primary buttons, active nav pill, "School" event category, selected calendar day |
| Secondary accent | `amber-600` | `#d97706` | "Activity" event category, "Extract" button |
| Tertiary accent | `emerald-700` | `#047857` | "Reminder" event category, "Info" notice category, confirm/"Add" button |
| Homework accent | `red-700` / `red-800` | `#b91c1c` / `#991b1b` | All homework entries, "Homework" notice category, homework calendar dots |
| Neutral text | `stone-800` / `stone-600` / `stone-500` | — | Titles, body text, secondary text |
| Background | Gradient `orange-50 → amber-50 → stone-50` | — | Page background |
| Card surface | `white` | `#ffffff` | Event/notice/homework/draft cards |
| Borders | `orange-100` / `orange-200` (dashed for header/nav) | — | Card borders, header/nav dividers |

### 8.3 Typography

- **Nunito** (`font-body`) — the default body font throughout, and (per a later revision) also used for the app title and calendar month/year label, after an earlier italic-serif treatment (Playfair Display) was judged less legible/desirable for those spots.
- **Playfair Display** (`font-display`) — still loaded and available, though no longer applied to the title after the font-body revision; retained in the stylesheet in case it's wanted elsewhere later.

### 8.4 Iconography

Two independent icon sets exist (see §7.1):
- **Vite/jsx version:** `lucide-react` — `Calendar`, `Camera`, `Type`, `Plus`, `Check`, `X`, `Clock`, `MapPin`, `Loader2`, `Sparkles`, `ChevronLeft`, `ChevronRight`, `Trash2`, `ImagePlus`, `ClipboardList`, `CalendarClock`, `Flower2`, `BookOpen`, `Search`, `FileText`.
- **Standalone HTML version:** a local, dependency-free set —
  - Emoji-based (decorative, non-interactive contexts): 📅 Calendar, 📷 Camera, 📝 Type, 🕐 Clock, 📍 MapPin, ✨ Sparkles, 🗑️ Trash2, 🖼️ ImagePlus, 📋 ClipboardList, ⏰ CalendarClock, 🌸 Flower2, 📓 BookOpen.
  - Hand-rolled SVG (interactive, need `currentColor`/hover-state support): Plus, Check, X, ChevronLeft, ChevronRight.
  - CSS-spinner (no icon asset): Loader2, rendered as a bordered circle with `animate-spin`.

### 8.5 Layout conventions

- Single-column, mobile-first, capped at `max-w-md` and centered — designed to look correct as a phone-width column even on a desktop browser.
- Cards: `rounded-2xl`, white background, 4px colored left border indicating category/type, drop shadow (`shadow-sm`).
- Buttons: `rounded-xl` or fully rounded for pills; primary actions use solid warm-accent fills with white text.
- Bottom navigation: fixed, four equal-width tabs, active tab shown as a filled pill (`bg-orange-100 text-orange-800`) rather than just a color change.
- Header: sticky, dashed bottom border, flower-icon badge + date + title on the left, search toggle on the right.

---

## 9. Security & Privacy Considerations

| Concern | Current approach | Trade-off |
|---|---|---|
| Anthropic API key exposure | Held server-side in a Cloudflare Worker secret, never shipped to the browser | None significant — this is the standard safe pattern |
| Firestore data access | A single open rule (`allow read, write: if true`) scoped to exactly one document path (`family_data/board`) | Anyone who discovers the exact Firebase project ID could theoretically read/write that one document. No authentication exists. Accepted as reasonable for a low-stakes personal family tool; flagged to the user as an area to revisit (e.g. Firebase Authentication) if higher assurance is wanted later |
| Site-level access control | None — whoever has the GitHub Pages URL can open the app | The repository must be public for free-tier GitHub Pages, so the deployed HTML (including the visible `PROXY_URL` and `FIREBASE_PROJECT_ID` constants) is technically viewable by anyone who finds the URL, though the Worker still guards the actual API key |
| Data at rest | Firestore's own infrastructure; no additional encryption layer added by the app | Standard Google Cloud protections apply; no extra app-level encryption |

---

## 10. Known Limitations

1. **Polling, not push** — the other device's changes take up to ~8 seconds to appear; there's no instant/live update.
2. **Last-write-wins** — if both users edit at the exact same moment, whichever save lands last on the server overwrites the other silently. No merge or conflict warning.
3. **No offline queueing** — if a save fails (e.g. no network), it's silently dropped rather than retried once connectivity returns; the local UI still reflects the change until a future poll overwrites it with the last successfully-synced remote state.
4. **No editing of confirmed entries** — once an event/notice/homework item is confirmed, it can only be deleted, not edited in place; corrections require deleting and re-adding.
5. **No authentication** — see §9.
6. **AI extraction is not free** — each Extract call costs a small amount via the Anthropic API (routed through the user's own Cloudflare Worker and API key).
7. **Attachments aren't retained** — photos/PDFs used for extraction are only held in memory during the capture flow; the original file isn't stored or attachable to the resulting entry.
8. **Single shared board** — the data model assumes one household sharing one document; it does not support multiple separate family groups or per-child boards.
9. **In-browser JIT transpilation** — the standalone file recompiles its own JSX and Tailwind classes on every page load (no caching/pre-build), which is slightly slower than a production build but avoids any build tooling for the user.

---

## 11. Future Enhancements (not yet built)

- Firebase Authentication to restrict the shared board to specific logged-in users.
- True real-time sync via Firestore's SDK listeners (`onSnapshot`) instead of polling, once the app moves off the REST-only, dependency-free constraint.
- In-place editing of confirmed events/notices/homework.
- Push notifications / reminders ahead of event dates.
- Recurring events (weekly PE day, etc.).
- Attachment retention — keep the original photo/PDF alongside its extracted entry for reference.
- Multi-board / multi-family support.
- A proper Vite build + GitHub Actions pipeline (scaffolding for this already exists as `deploy.yml`) if the project outgrows the no-build single-file approach.

---

## 12. File & Code Reference

| File | Role |
|---|---|
| `school-calendar.jsx` | React component source (ES modules, `lucide-react`) — used for in-Claude live testing and as the basis for a future proper build |
| `school-calendar.html` / `index.html` | The deployed, dependency-free standalone build — what actually ships to GitHub Pages |
| `cloudflare-worker.js` | Source for the Cloudflare Worker that proxies Anthropic API calls and hides the API key |
| `deploy.yml` | GitHub Actions workflow scaffold for a future Vite-based build/deploy pipeline (not currently in active use, since the standalone HTML ships without a build step) |

### Key functions (shared logic across both codebases)

| Function | Responsibility |
|---|---|
| `todayISO()` | Returns today's date as `YYYY-MM-DD` |
| `formatDateLabel(dateStr)` | Renders "Today" / "Tomorrow" / full weekday-month-day for any other date |
| `fileToBase64(file)` | Converts a `File` to a base64 string via `FileReader` |
| `buildMonthMatrix(monthDate)` | Produces the week-chunked day grid for the calendar |
| `callClaude(blocks, mode)` | Sends one Messages API request (general or homework prompt) and parses the JSON array response |
| `loadSharedState()` / `saveSharedState(...)` | Firestore REST GET/PATCH for the shared document |
| `persist(nextEvents, nextNotices, nextHomework)` | Single choke point for all state mutations — updates local state and triggers a remote save |
| `handleExtract()` | Orchestrates building content blocks from the current capture mode and turning the AI response into drafts |
| `confirmDrafts()` | Splits drafts by type, merges into the three main arrays, persists, and navigates to the relevant tab |
| `jumpToDate(iso)` | Used by search results to navigate the calendar to a specific day |
