# Bingo Multiplayer - Handover Document

**Date:** 2026-03-30
**Branch:** `claude/create-handover-doc-oAhld`
**Repo:** `icemochabun/bingo-multiplayer`

---

## Project Overview

A real-time multiplayer bingo game with QR code join functionality. Players host or join rooms, get randomly generated 5x5 bingo cards, and compete as the host calls numbers one at a time.

---

## Project Structure

```
bingo-multiplayer/
├── .github/workflows/deploy.yml   # GitHub Pages deployment (triggers on main or claude/multiplayer-bingo-qr-EAMj4)
├── server.js                       # Express + WebSocket backend (server-based approach)
├── package.json
└── public/
    ├── index.html                  # Single HTML file, all screens
    ├── app.js                      # Frontend logic (PeerJS P2P approach)
    ├── style.css                   # All styling
    └── qrcode-generator.js         # Bundled QR code library (no external CDN)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express ^4.18.2, ws ^8.16.0, uuid ^9.0.0 |
| Frontend | Vanilla JS, PeerJS 1.5.2 (CDN), CSS3 |
| QR Code | qrcode-generator ^1.4.4 (bundled locally) |
| Deployment | GitHub Actions → GitHub Pages |

**Run locally:**
```bash
npm install
npm start   # starts server.js on http://localhost:3000
```

---

## Critical Architectural Issue

**Two separate implementations exist and are NOT integrated:**

### Approach A: `server.js` (WebSocket/Express)
- Server is the authoritative game state
- REST: `POST /api/rooms` to create, `GET /api/rooms/:id` to inspect
- WebSocket messages: `join`, `startGame`, `callNumber`, `markCell`
- Server generates player cards, tracks called numbers, detects bingo
- **Status:** Fully implemented, ~326 lines
- **Not used in production** - GitHub Pages only serves static files

### Approach B: `public/app.js` (PeerJS/WebRTC)
- Host browser is the authoritative game state (P2P, no server needed)
- Host generates 6-char room code, shares QR link `?join=<peerId>`
- Messages between host/guest: `guestJoined`, `cardAssigned`, `gameStarted`, `numberCalled`, `bingoConfirmed`, `playAgain`
- Cards generated client-side, win detection runs on host
- **Status:** Fully implemented, ~551 lines
- **This is what GitHub Pages deploys and runs**

**Decision needed:** Choose one approach and remove the other. The static PeerJS version is currently the live/deployed version.

---

## Game Logic

- 5x5 cards, standard BINGO column ranges (B:1-15, I:16-30, N:31-45, G:46-60, O:61-75)
- Center cell is a free space (position [2][2])
- Call bag: all 75 numbers shuffled, drawn one at a time
- Win conditions: 5 in a row (horizontal), 5 in a column, or either diagonal
- Max 2 players (host + 1 guest)

---

## Frontend Screens (index.html)

| Screen ID | Description |
|-----------|-------------|
| `#home-screen` | Create game or enter join code |
| `#lobby-screen` | Host waits, shows QR code + room code, start button |
| `#join-screen` | Guest enters name to join |
| `#game-screen` | Active gameplay: called numbers list, bingo card grid |
| `#winner-screen` | Trophy, winner name, play again option |

Screen transitions are controlled in `app.js` via `showScreen(id)`.

---

## Key Functions in `app.js`

| Function | Purpose |
|----------|---------|
| `generateBingoCard()` | Returns 5x5 2D array with valid BINGO numbers |
| `generateCallBag()` | Returns shuffled array of 1-75 |
| `checkBingo(card, marked)` | Returns true if any win condition met |
| `renderCard(card, marked, called)` | Renders the bingo card DOM |
| `escapeHtml(str)` | Basic XSS protection for player names |
| `createGame()` | Host flow: init PeerJS, show lobby |
| `joinGame()` | Guest flow: connect to host peer |
| `callNumber()` | Host calls next number, broadcasts to guest |

---

## Known Issues & Technical Debt

### Security
- `escapeHtml()` applied to player names in most places, but audit all `innerHTML` usage
- No input length enforcement server-side (HTML `maxlength` is UI-only)
- No rate limiting on room creation
- Room codes are 6-char alphanumeric — short but ~1B combinations
- `/api/rooms/:id` endpoint is public (exposes room state)

### Bugs
- No card collision prevention: two players could theoretically get identical cards (low probability)
- No graceful handling of host disconnect mid-game
- No reconnection logic if WebRTC connection drops

### Dead Code
- `server.js` is unused in production (GitHub Pages is static-only)
- `qrcode` npm package installed but not used (replaced by `qrcode-generator`)

---

## GitHub Actions Deploy Workflow

File: `.github/workflows/deploy.yml`

- Triggers on push to `main` or `claude/multiplayer-bingo-qr-EAMj4`
- Deploys only the `public/` directory to GitHub Pages
- `server.js` is never deployed

---

## Git History Summary

```
7161d19  Add qrcode-generator to package.json dependencies
2c4f232  Fix QR code: bundle qrcode-generator locally, no external deps
811c4e8  Fix QR code: use qrserver.com image API instead of JS library
255ba07  Fix QR code display: switch from qrcode npm to QRious
5a9011b  Fix bingo card duplicates, room code, and join bugs
2cd4339  Convert to static app (PeerJS) and add GitHub Pages deploy
37a1531  Add multiplayer bingo web app with QR code join  ← initial
```

The project started server-based, then was converted to a static PeerJS app for GitHub Pages. Multiple iterations were needed to fix the QR code display.

---

## Recommended Next Steps

1. **Resolve architecture conflict** — commit to PeerJS static approach (remove server.js + unused deps) OR switch to server-based and deploy to Node.js hosting
2. **Add error handling** — connection drops, peer unavailable, game already started
3. **Add reconnection** — if guest loses connection mid-game
4. **Support >2 players** — current cap is 1 host + 1 guest
5. **Add tests** — at minimum unit tests for `generateBingoCard()`, `checkBingo()`
6. **Improve room codes** — consider longer codes or UUID format to reduce collision risk
7. **Clean up deps** — remove unused `qrcode` package

---

## How to Pick Up This Session

1. Clone/check out branch `claude/create-handover-doc-oAhld` (or `main` after merge)
2. Run `npm install && npm start` for local backend testing
3. Open `public/index.html` directly in two browser tabs to test PeerJS locally (no server needed)
4. The live deployed version uses PeerJS — test that path first

The biggest open question is the **architecture decision** in the "Critical Architectural Issue" section above. Resolving that unblocks cleanup and future feature work.
