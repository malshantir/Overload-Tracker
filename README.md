# OVERLOAD Tracker

A mobile-first progressive overload fitness PWA built with React and Vite. Designed for lifters who want to track their training intelligently — not just log numbers, but actually progress.

## Live Demo
🔗 [Live Demo](https://overload-tracker-1aub-gamma.vercel.app)

## Features

- **Custom Program Builder** — Create training splits with custom days and exercises, set rep ranges and set counts
- **Intelligent Session Logging** — Log weight and reps per set with previous session data shown as reference
- **Progressive Overload Coaching** — Coaching tips based on last session performance (increase weight, push more reps, or maintain)
- **Rest Timer** — Built-in rest timer with custom duration presets that persist across sets and continue counting when app is backgrounded
- **Exercise Notes** — Add per-exercise notes that carry over to future sessions
- **Progress Tracking** — Visual progress charts per exercise with session history and best set tracking
- **Calendar View** — Full training history calendar with session details
- **Dynamic Session Editing** — Add/remove exercises and sets mid-session with option to save changes permanently to your program
- **Exercise Reordering** — Reorder exercises during active sessions with up/down controls, with option to save new order permanently
- **Multiple Programs** — Create new training programs while preserving full historical data
- **Cross-Device Sync** — Data persists across devices via Supabase backend
- **User Authentication** — Real authentication with email confirmation and forgot password flow powered by Supabase

## Tech Stack

- **Frontend:** React 18, Vite
- **Backend:** Supabase (authentication, database, real-time sync)
- **Styling:** Custom CSS with CSS variables, dark theme
- **State Management:** React useState/useEffect hooks
- **Deployment:** Vercel

## Roadmap

- [x] Vercel deployment
- [x] Supabase backend integration for cross-device sync
- [ ] AI progress analysis powered by Claude API
- [ ] PWA setup for native mobile installation
- [ ] Design polish with animation libraries

## Running Locally

```bash
git clone https://github.com/malshantir/Overload-Tracker.git
cd Overload-Tracker
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

## Development Approach

Built independently as a personal fitness tracking tool I actually use for my own training. Developed using Claude Code as an AI-assisted workflow tool — planning features, debugging issues, and iterating on solutions. This reflects how modern engineering teams increasingly leverage AI tooling to ship better software faster.

## Author

Mohammed Alshantir — IT Student
[GitHub](https://github.com/malshantir)