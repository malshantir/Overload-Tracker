# OVERLOAD TRACKER — Project Context

## Development Rules

These rules are non-negotiable and apply to every change:

1. **Never remove existing features** unless the user explicitly asks to remove them.
2. **Only change what is necessary** for each request — no refactors, cleanups, or "improvements" beyond the stated task.
3. **Always maintain consistent back button navigation** — every drill-down page must have a `.back-btn` in the top-left that returns to the correct parent view.
4. **Always keep dark theme styling** — all new UI must use `var(--bg*)`, `var(--c*)`, and design token colors. Never hardcode light colors. Never break the dark/light theme toggle.
5. **Never break existing functionality** when adding new features — run `npm run build` after every change to verify no compile errors before reporting done.
6. **Split page must always read localStorage directly to determine its initial phase** — `SplitPage`'s `phase` state MUST be initialised by reading `localStorage.getItem(SK_P)` directly inside the `useState` initializer function, NOT from the `program` prop. The prop can be null on first render (auth flow, state reset) and `useState` only evaluates its initializer once — relying on the prop causes `phase` to lock to `"onboard"` even when data exists. The correct pattern, which must never be changed:
   ```js
   const [phase, setPhase] = useState(() => {
     try {
       const saved = JSON.parse(localStorage.getItem(SK_P) || "null");
       return saved?.sessions?.length > 0 ? "editor" : "onboard";
     } catch { return "onboard"; }
   });
   useEffect(() => {
     if (program?.sessions?.length > 0 && phase === "onboard") setPhase("editor");
   }, [program]);
   ```
   The `useEffect` is a belt-and-suspenders guard for late-arriving prop updates. Both are required. Never replace either with a simple `program?.sessions?.length > 0` check.

---

## What This App Is

A mobile-first progressive overload fitness tracking PWA. Users build a training split, log sessions, and track strength progress over time via e1RM charts. No backend — all state lives in `localStorage`.

## Tech Stack

- **React 19** (functional components, hooks only)
- **Vite 8** build tool
- **No external UI libraries** — all components hand-built
- **No CSS files** — all styles live in a tagged-template CSS string inside `App.jsx`
- **No router** — page visibility controlled by opacity/pointer-events toggling (`.pg` / `.pg.act`)
- **Fonts**: `DM Mono` (body/UI) + `Bebas Neue` (headings/stats) — loaded via Google Fonts import at the top of the CSS string

## File Structure

```
src/
  App.jsx       ← entire app, ~3000 lines, single file
  index.css     ← only global resets (body margin, #root sizing)
  main.jsx      ← mounts App
public/
  ...
CLAUDE.md       ← this file
package.json
```

**All work happens in `src/App.jsx`.** Never create new component files. Never create new CSS files.

---

## Architecture

### CSS

All styles are in the `const CSS = \`...\`` string near the top of `App.jsx`, injected via `<style>{CSS}</style>` in the root render. To add styles, append to this string before the closing backtick.

### CSS Design Tokens

```css
/* Dark mode (default) */
--bg:#080808  --bg2:#0d0d0d  --bg3:#111  --bg4:#161616  --bg5:#1e1e1e
--c1:#e8e8e8  --c2:#aaa  --c3:#666  --c4:#3a3a3a  --c5:#252525
--green:#4ade80  --red:#f87171  --amber:#fbbf24  --blue:#60a5fa  --gold:#f59e0b
--bdr:#1e1e1e  --r:8px  --rsm:5px
```

Light mode is toggled by adding `html.light` class. Light mode overrides all tokens with lighter values.

### Design Rules

- **Mobile-first**: Max content width `480px`, centered. All layouts designed for portrait mobile. No breakpoints needed for wider screens — the app is constrained to 480px.
- **Dark theme is the default and must always work**: All new UI uses `var(--bg*)` / `var(--c*)` tokens. Never hardcode `#fff`, `#000`, or any fixed color that would break in dark mode. Light mode is opt-in via `html.light`.
- **Font**: `DM Mono` monospace throughout for all body text, labels, inputs, and UI. `Bebas Neue` for large titles, stat numbers, and section headers — loaded from Google Fonts at the top of the CSS string.
- **Text sizes**: Labels/badges at 8–9px with `letter-spacing:.1em+`. Body 11–13px. Headings via Bebas at 22–56px.
- **ALL CAPS** for all labels, buttons, headings, and UI text.
- **Buttons**:
  - `.bp` — primary (white bg, dark text)
  - `.bo` — outline (transparent bg, border)
  - `.bg-btn` — ghost (no border, text-only)
  - `.ib` — icon button (small, square)
  - `.back-btn` — chevron + "BACK" text, top-left of drill-down pages
- **Cards**: `.card`, `.ex-card`, `.day-card`, `.gcard` — all use `var(--bg2)` bg + `var(--bdr)` border + `var(--r)` radius
- **Bottom drawer**: `.drw` / `.drw-ov` pattern. Always use the `<Drawer>` component.
- **Toasts**: Call `showToast("MESSAGE", variant?)`. Variants: `"tg"` (green), `"tgold"` (gold), default (neutral).
- **Sticky headers**: `.hdr` class — `position:sticky; top:0; z-index:10`. Padded `52px` left to clear the hamburger button.
- **Full-screen overlays**: `position:fixed; inset:0; z-index:82+` (profile-type pages) or `z-index:90+` (completion screen).

### State & Persistence

All persistent data stored in `localStorage` under these keys:

| Key | Constant | Contents |
|-----|----------|----------|
| `ot-prog-v5` | `SK_P` | Training program (split + exercises + program name) |
| `ot-sess-v5` | `SK_S` | Session logs + completion markers |
| `ot-user-v5` | `SK_U` | User profile data (name, email, username, age, weight, height) |
| `ot-launched-v5` | `SK_L` | "1" if onboarding completed |
| `ot-account-v1` | `SK_ACCOUNT` | Auth credentials (email/password/username) |
| `ot-session-v1` | `SK_SESSION` | Active auth session token |
| `ot-settings-v1` | `SK_SETTINGS` | App settings (units, theme) |
| `ot-dup-pref-v1` | `SK_DUP` | Duplicate exercise preference: `"by_day"` or `"combined"` |
| `ot-active-v1` | `SK_ACTIVE` | Active session timer: `{ sessId, elapsedSecs, startedAt }` |
| `ot-rest-v1` | `SK_REST` | Default rest timer duration in seconds (persists user's last chosen value) |
| `ot-exnames-v1` | `SK_EXNAMES` | Exercise ID to name/program mappings: `{ exId: { name: "Exercise Name", program: "Program Name" } }` — persists across program creation to enable historical data display |

**Session log keys** in `SK_S` object:
- `{sessId}__{date}` → log object `{ [exId]: { [setIndex]: { weight, reps, rir } } }`
- `{sessId}__date` → ISO date string for this session
- `{sessId}__completed` → ISO date string when completed

### Data Shapes

```js
// Program
{
  units: "lb" | "kg",
  sessions: [{
    id: string,
    name: string,
    exercises: [{
      id: string,
      name: string,
      sets: number,
      rep_min: number,
      rep_max: number,
      progression: "double" | "linear" | ...,
      increment: number,
      notes: string,
      order_index: number
    }]
  }]
}

// Active session timer (SK_ACTIVE)
{ sessId: string, elapsedSecs: number, startedAt: number | null }
// startedAt is null when paused, Date.now() ms timestamp when running
```

---

## Navigation

**Bottom nav** (5 tabs): HOME → SPLIT → LOG → CAL → PROGRESS

The INTRO page still exists and is the initial `page` state for new users (no split), but it is **not in the nav**. Returning users (launched + has split) are automatically redirected from `"intro"` to `"home"` via a root App useEffect.

Pages render via `.pg` / `.pg.act` CSS opacity toggling — all pages are always mounted. The `page` state string in App controls which is visible.

**Hamburger menu** (top-left): Opens a slide-in panel with links to Profile, Settings, Account, Support, and Log Out. Sub-pages (Profile, Settings, Account, Support) render as full-screen `position:fixed` overlays at z-index:82.

---

## Feature Inventory

### HOME Page (`HomePage`)

Default landing page for logged-in users who have an existing split. Not accessible to new users until a split is created.

- **Greeting** (sticky header): `GOOD MORNING/AFTERNOON/EVENING, [First Name] 💪` — time-based (morning 0–11, afternoon 12–17, evening 18–23). First name read from `SK_U`. Today's date displayed below.
- **TODAY'S FOCUS card**: Shows the recommended next training day. Recommendation logic:
  - If `SK_ACTIVE` has an active session → show that day with "RESUME SESSION →"
  - Otherwise → find the `{sessId}__completed` key with the most recent date, suggest the NEXT session in split order (wraps around). Falls back to day 1 if no sessions completed.
  - "START SESSION →" / "RESUME SESSION →" button navigates to Log tab and auto-starts the session via `pendingSessionIdx` state in root App → `LogPage` useEffect.
  - Button styling: dark background (`var(--bg3)`), white text, subtle border (`var(--bdr)`)
- **QUICK STATS row**: Three `.card` tiles matching the Calendar's data source exactly:
  - **Total Sessions**: count of `program.sessions` where `sessions[`${s.id}__completed`]` is truthy
  - **This Week**: same filter, but completion date >= Monday of current week (ISO comparison)
  - **Streak**: consecutive days with any completion, counting backwards from today (or yesterday if not trained today), using the Set of `__completed` dates
  - Stats use `__completed` keys (not log keys) to match Calendar exactly — in-progress sessions without `__completed` are not counted
- **LAST SESSION section** (below QUICK STATS): Shows the most recently completed training day with exercise count and date (only displayed if at least one session has been completed)
- **DAILY MOTIVATION section** (below LAST SESSION): Displays a motivational quote that changes daily based on the day of year. Selects from a curated list of fitness-focused motivational messages

### SPLIT Page (`SplitPage`)

Header shows **"MY PROGRAM"** (planning tool framing). Day names display in **uppercase** (`.toUpperCase()` at render time — stored names are not modified).

- **Onboarding flow** (3 steps):
  1. **STEP 1**: Enter program name (required, text input with placeholder "e.g. Push Pull Legs, My Bulk Program")
  2. **STEP 2**: Choose number of training days per week (1-7 buttons)
  3. **STEP 3**: Name each training day (text inputs with validation for unique names)
- **Program creation**: `buildProgram()` creates the split with the program name saved in the program object (persisted to `SK_P`). Exercise name mappings saved separately to `SK_EXNAMES` with program name included.
- **CREATE NEW PROGRAM button**: Top-right of header (in editor phase). Opens confirmation modal before clearing `SK_P` and resetting onboarding. Session history (`SK_S`) and exercise metadata (`SK_EXNAMES`) are **never** cleared, allowing historical data to be displayed on Calendar and Progress pages.
- **Overview**: day cards listed vertically (name + exercise count). Tapping opens `DayEditPage`. Each card has an edit icon (pencil) that opens a rename/delete drawer.
- **Day editor** (`DayEditPage`): add, edit, reorder, delete exercises. Inline rename for day name. Back/Save button returns to overview.
- **Add exercise** (`ExForm`): name, sets, rep range. Sets field starts blank (no default). Rep range starts blank (no default). Exercise name is auto-converted to **Title Case** on save via `toTitleCase()`. Progression silently defaults to `"double"`. Notes field hidden from UI.
- **Duplicate detection**: On back from day editor, `findDuplicateExNames()` checks if any exercise name appears across multiple days. If yes and preference not yet set, shows `DupPrefDrawer`.
- **`DupPrefDrawer`**: one-time prompt — "BY DAY" (separate progress charts) or "COMBINED" (merged). Saves to `SK_DUP` and updates root App `dupPref` state so Progress page updates immediately.
- **Add day**: `AddDayDrawer` — validates unique name.
- `SK_DUP` is cleared when `buildProgram()` runs (new split resets the preference).

### LOG Page (`LogPage`)

**Phase: overview**

Day names display in **uppercase**. No chevron on cards — tapping selects rather than navigates.

- "SELECT A DAY TO BEGIN" instruction shown above cards
- Each day card shows:
  - Day name (uppercase)
  - "LAST TRAINED: [date]" from `sessions[`${s.id}__completed`]`, or "NOT YET TRAINED"
  - Exercise count
  - Animated green `inprog-dot` if that day has an active in-progress session
- **Selection flow** (reversed from original):
  1. User taps a day card → card gets blue border highlight (`selectedOverviewIdx` state)
  2. Tapping the same card again **deselects** it (toggles `selectedOverviewIdx` to `null`)
  3. "START SESSION →" button is greyed out (`opacity: 0.35, pointerEvents: none`) until a card is selected
  4. Tapping "START SESSION →" with a selection calls `beginSession(selectedOverviewIdx)` directly — no drawer
- `selectedOverviewIdx` is reset to `null` whenever returning to overview (back from session, completion screen, discard)
- Green "RESUME" banner at top if a session is in progress (tapping it resumes directly, independent of card selection)

**Phase: session (workout logging)**
- Back button (top-left) pauses the session timer and returns to overview (data preserved)
- Counting-up session timer with green pulsing dot (top-right of header)
- Single **REST** timer button in header (replaces per-exercise timers). Duration saved to `SK_REST` on change.
- Session name + date pill in header
- Per-exercise cards: sets × (weight + reps inputs), RIR chips, last-session comparison, PR detection
- **Coaching tip** at top of each exercise card (green or blue banner):
  - Green "PROGRESS ↑" — "Great work! Try adding weight **this** session." — if any set hit `rep_max` last session
  - Blue "COACH →" — "Same weight — aim for more reps." — if no sets hit `rep_max`
  - Only shown when last-session data exists for that exercise
- Readiness check drawer (sleep/soreness/stress)
- Date picker (change training date)
- **DISCARD** button (red ghost, left side of actions bar) — shows confirmation before clearing session and returning to overview
- "COMPLETE SESSION" saves to localStorage, clears `SK_ACTIVE`, shows completion screen
- **CHECK button removed**: No longer displayed during active session logging

**Phase: overview (day selection)**
- Exercise count text is **left-aligned** (not centered) on day cards

**Completion screen** (`completionData` state):
- Full-screen overlay (z-index:90), `position:fixed`
- Stats: Total Volume · Sets Completed · Session Duration · PRs Hit (gold, only if > 0)
- "← BACK TO LOG" returns to overview

**Session timer persistence**:
- `SK_ACTIVE` stores `{ sessId, elapsedSecs, startedAt }`
- `startedAt` is null when paused, `Date.now()` ms when running
- `calcElapsed(info)` computes current seconds from this object
- Timer pauses when user goes back to overview, resumes on re-entry

**PR detection**: `getAllTimeMaxE1rm(exId)` compares new set's e1RM against all previous sessions. `showToast("🏆 NEW PR!", "tgold")` fires on detection. Gold border glow on exercise card.

### CALENDAR Page (`CalendarPage`)

- Monthly grid view with completed session dots
- Filter by training day
- Tap a date to see session detail sheet

### PROGRESS Page (`ProgressPage`)

- Search/filter exercises
- Per-exercise e1RM sparkline charts (8w / 3m / 6m / all time ranges)
- Metric toggle: e1RM vs max weight vs total volume
- Tap exercise for detail view: full chart + per-session breakdown + session filter
- **Historical exercise data**: Displays exercises from all previous programs alongside current program exercises. Data from old programs remains visible and usable even after creating a new program.
- **Program labels on exercises**: Each exercise shows which program it belongs to:
  - Exercises from the **current active program**: no label (clean appearance)
  - Exercises from **previous programs**: show "From: {Program Name}" subtitle below exercise name in small muted text (fontSize 8, color var(--c4))
- `buildMergedData()` groups exercises respecting `SK_DUP` preference:
  - `"by_day"`: duplicate exercises appear as `"Bench Press (Push)"` / `"Bench Press (Upper)"`
  - `"combined"`: all data for same-named exercises merged into one chart
  - Includes historical exercises from `SK_EXNAMES` mapping with program metadata
- Status pills: Progressing (green) / Maintaining (amber) / Regressing (red)

### Profile / Account / Settings / Support

All render as full-screen `position:fixed` overlays at z-index:82, accessed via the hamburger menu.

- **Profile**: Accordion with two sections (both open by default). Reads `SK_U` synchronously in `useState` initializer (not a useEffect) to avoid flash of `—`. Personal Details shows username, name, and email (username/name from `SK_U`, email from `SK_ACCOUNT`). Physical Stats shows age, weight, height. All fields editable inline. `SK_U` is **not** cleared on logout — profile data persists across login cycles since there is no re-setup step on re-login. Username field has edit icon for inline editing (synced with Account page).
- **Account**: editable username/password fields. **Change Username** replaces the old "Change Email" option. Username changes are synced with Profile page. "DELETE ACCOUNT" option (clears all localStorage including `SK_U`). All password fields have `autocomplete='new-password'` to prevent browser auto-fill; username field has `autocomplete='off'`.
- **Settings**: Three accordion sections — Units (lb/kg), Theme (dark/light), and **Exercise Tracking** (by_day / combined). Exercise Tracking reads/writes `SK_DUP` and updates root App `dupPref` state so Progress page reacts immediately without page reload. Saved to `SK_SETTINGS` for units/theme; `SK_DUP` for tracking preference.
- **Support**: Contact Support / Privacy Policy / Terms of Service sub-views. Support sub-views go back to the Support list (not the main menu).

### Auth Flow

`authState` in root App: `"welcome"` → `"signup"` / `"login"` → `"setup"` → `"app"`

- `WelcomeScreen` → `SignUpForm` or `LogInForm`
- **SignUpForm**: Username field (required, min 3 characters, `autocomplete='off'`) as the first field, followed by email and password. All fields stored to `SK_ACCOUNT` (username/email) on account creation.
- After signup: clears all data keys, goes to `UserSetupForm` (onboarding)
- `handleLogOut()` clears `SK_P, SK_S, SK_L, SK_DUP, SK_SESSION` — **does not clear `SK_U`** (profile data must survive logout since re-login has no setup step)

---

## Key Helper Functions (module-level)

| Function | Purpose |
|----------|---------|
| `uid()` | Random 7-char ID |
| `todayISO()` | `"YYYY-MM-DD"` |
| `fmtDate(iso)` | `"Mon, Jun 3"` |
| `e1rmCalc(w, r)` | Epley formula: `w * (1 + r/30)` |
| `normalizeName(n)` | lowercase, trimmed, trailing-s stripped (for dedup) |
| `calcElapsed(info)` | Compute seconds from `SK_ACTIVE` object |
| `fmtSessDur(secs)` | `"M:SS"` or `"H:MM:SS"` |
| `findDuplicateExNames(program)` | Returns normalized names appearing in 2+ sessions |
| `calcPrescription(ex, lastSets)` | Returns `{ tip, variant }` coaching tip. Green "PROGRESS ↑" if any set hit `rep_max`; blue "COACH →" otherwise. |
| `validateName(n)` | Returns error string or null |
| `toTitleCase(str)` | Capitalises first letter of every word, lowercases the rest. Applied to all exercise names on save (`ExForm`) and on load from localStorage. |
| `normalizeExerciseNames(prog)` | Walks the full program object and applies `toTitleCase` to every `ex.name`. Called in root App's localStorage load effect so existing stored names display in Title Case automatically. |
| `saveExerciseNames(program)` | Saves all exercise IDs and their names + program name to `SK_EXNAMES`. Called whenever a program is saved. Enables historical data display when programs are recreated. |
| `getExerciseName(exId)` | Retrieves exercise name from `SK_EXNAMES` mapping. Handles both old string format and new object format with backwards compatibility. Returns null if not found. |
| `getExerciseProgram(exId)` | Retrieves program name from `SK_EXNAMES` mapping for a given exercise ID. Returns null for old format entries or if not found. Used to display "From: {Program Name}" labels on Progress page. |
| `isValidExerciseName(name)` | Validates exercise name entries — filters out "Exercise 0", random-looking exercise IDs, null/undefined, and empty strings. Used when building historical exercise data. |

## Key Shared Components

| Component | Purpose |
|-----------|---------|
| `<HomePage>` | Default landing page. Props: `program`, `sessions`, `onStartSession(idx)` |
| `<Drawer open onClose>` | Bottom sheet drawer (`.drw` pattern) |
| `<Toast>` | Floating notification |
| `<Sparkline>` | SVG sparkline chart |
| `<InlineName>` | Tap-to-edit inline text field |
| `Icons.*` | Inline SVG icon set (no external icon lib). Includes `Icons.Home` for nav. |
| `useExTimer()` | Per-exercise rest countdown timer hook |

**Cross-component session start pattern (Home → Log):**
Root App holds `pendingSessionIdx` state. `handleHomeStartSession(idx)` sets it and navigates to `"log"`. `LogPage` has a `useEffect([pendingSessionIdx])` that calls `beginSession(idx)` and clears the pending state. This bypasses the Log overview entirely.

---

## Development

```powershell
npm run dev      # start dev server
npm run build    # production build (always run to verify before reporting done)
npm run preview  # preview production build
```

The app is a single-page app with no routing library. Always run `npm run build` after changes to confirm no compile errors before finishing a task.

---

## Planned Features (Not Yet Built)

These features are scoped and intended but have not been implemented. Do not implement them unless explicitly asked — document them here so future sessions have the full picture.

### Light Mode Fix

Light mode can be toggled via Settings but currently has visual issues (some hardcoded colors don't respond to `html.light`). The fix involves:
- Auditing all inline `style={}` color values in `App.jsx` that bypass CSS tokens
- Replacing any hardcoded `#` color values with the appropriate `var(--*)` token
- Verifying every page and overlay looks correct with `html.light` active

### Supabase Backend Integration

Currently all data lives in `localStorage` only. The plan is to add Supabase as an optional cloud sync layer:
- Auth: replace the fake local auth (`SK_ACCOUNT` / `SK_SESSION`) with Supabase Auth (email/password)
- Database: sync `SK_P` (program) and `SK_S` (sessions) to Supabase tables, with `localStorage` as the offline cache
- The app must continue to work fully offline — Supabase is additive, not a hard dependency
- `SK_ACCOUNT` and `SK_SESSION` storage keys will likely be replaced by Supabase session tokens

### PWA Setup

The app is described as a PWA but doesn't yet have a full PWA configuration:
- Add a `manifest.json` (name, icons, `display: standalone`, theme color `#080808`)
- Add a service worker via Vite PWA plugin (`vite-plugin-pwa`) for offline caching
- Add iOS/Android meta tags to `index.html` for home screen install prompts
- App shell should load instantly from cache; session/program data served from `localStorage` as usual

### Smart Exercise Name Normalization

When users type exercise names in `ExForm`, common abbreviations should be auto-expanded on save:

| Abbreviation | Expands to |
|-------------|------------|
| `DB` | `Dumbbell` |
| `BB` | `Barbell` |
| `KB` | `Kettlebell` |
| `CS` | `Cable` |

- Case-insensitive match at word boundaries (e.g. `"DB curl"` → `"Dumbbell Curl"`, `"incline db press"` → `"Incline Dumbbell Press"`)
- Applied in `ExForm` on save, before `validateName()` runs
- Also applied when normalizing names for duplicate detection in `findDuplicateExNames()` so `"DB Curl"` and `"Dumbbell Curl"` are treated as the same exercise
