# OVERLOAD Tracker

A mobile-first progressive overload fitness PWA built with React and Vite. Designed for lifters who want to track their training intelligently — not just log numbers, but actually progress.

## Live Demo
[Live Demo](https://overload-tracker-1aub-gamma.vercel.app)

## Features

- **Custom Program Builder** — Create training splits with custom days and exercises, set rep ranges and set counts
- **Intelligent Session Logging** — Log weight and reps per set with previous session data shown as reference
- **Progressive Overload Coaching** — AI-powered coaching tips based on last session performance (increase weight, push more reps, or maintain)
- **Rest Timer** — Built-in rest timer with custom duration presets that persist across sets
- **Exercise Notes** — Add per-exercise notes that carry over to future sessions
- **Progress Tracking** — Visual progress charts per exercise with session history and best set tracking
- **Calendar View** — Full training history calendar with session details
- **Dynamic Session Editing** — Add/remove exercises and sets mid-session with option to save changes permanently
- **Exercise Reordering** — Drag-and-drop reordering of exercises during active sessions
- **Multiple Programs** — Create new training programs while preserving full historical data
- **User Authentication** — Local account system with username, email and password

## Tech Stack

- **Frontend:** React 18, Vite
- **Styling:** Custom CSS with CSS variables, dark theme
- **State Management:** React useState/useEffect hooks
- **Data Persistence:** localStorage (Supabase integration planned)
- **AI Coaching:** Progressive overload logic with Claude API integration planned
- **Deployment:** Vercel (coming soon)

## Roadmap

- [ ] Vercel deployment
- [ ] Supabase backend integration for cross-device sync
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

Developed using Claude Code as an AI-assisted development tool throughout the build process — demonstrating modern engineering workflows. Features were planned, prompted, debugged and iterated using AI tooling, reflecting how professional development teams increasingly work in 2026.

## Author

Mohammed Alshantir — IT Student
[GitHub](https://github.com/malshantir)