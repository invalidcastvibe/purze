# Purze

![Alt](https://repobeats.axiom.co/api/embed/754cf0503977a706ed6724856cf280b40e59358c.svg "Repobeats analytics image")

Purze is a compact, mobile-friendly Bitcoin Cash (BCH) and CashToken web wallet built with Vue 3 + TypeScript.

It is designed around four goals:
1. Fast everyday actions
2. Compact but readable UI
3. Intuitive wallet management
4. Power-user controls when needed

The app runs fully in the browser and stores wallet state locally on the device.

Repository: https://github.com/invalidcastvibe/purze

## Highlights

1. Multi-wallet support
2. Create and import wallets (single-address and HD)
3. BCH send/receive flows
4. CashToken send/receive flows
5. WalletConnect pairing and request approval
6. Notification center (send, receive, WalletConnect approval)
7. Token visibility and favorite controls
8. Custom derivation path support with presets
9. QR receive modal
10. Compact footer command/status bar

## Feature Overview

### Wallet Management

1. Create or import wallets
2. Switch active wallet quickly
3. Manage wallet details via action sheets
4. Backup and derivation management screens

### Derivation Paths

Purze supports:
1. Standard BCH path: `m/44'/145'/0'`
2. Bitcoin.com-style path: `m/44'/0'/0'`
3. Zapit-style path: `m/44'/245'/0'`
4. Custom parent or full path input

Custom path validation supports:
1. Parent format: `m/...` with account level
2. Full address format ending in `/0/0`

### BCH + CashToken Assets

1. Combined asset view for BCH and tokens
2. Token metadata hydration and icon loading
3. Favorite and hide token categories
4. Send history for BCH and token activity

### WalletConnect

1. Pair using `wc:` URI
2. Review and approve/reject connection proposals
3. Review and approve/reject session requests
4. View and disconnect active sessions

### Notifications

Notification types:
1. Send funds
2. Receive funds
3. WalletConnect approval

Notification capabilities:
1. Unread badge count
2. Mark all as read
3. Per-type toggle settings
4. Persisted notification history in local storage

### Footer Command Bar

The sticky footer includes:
1. Branding area (wallet icon links to GitHub repo)
2. Quick action icons for wallet list, WalletConnect, notifications, compact mode
3. Live status indicators (alerts, connected state)

## Tech Stack

1. Vue 3 + TypeScript
2. Vite
3. mainnet-js for BCH wallet operations
4. @reown/walletkit + @walletconnect/core for WalletConnect
5. @bitauth/libauth for signing/bytecode utilities
6. Font Awesome (solid icons)
7. qrcode for receive QR generation

## Project Structure

```text
.
├── public/
├── src/
│   ├── App.vue                 # Main app UI, state, wallet flows
│   ├── main.ts                 # App bootstrap and icon registry
│   ├── components/
│   │   └── UiSelect.vue        # Reusable select control
│   └── lib/
│       ├── derivation.ts       # Derivation presets + validation
│       ├── extendedJson.ts      # Extended JSON parser helpers
│       └── wcSigning.ts         # WalletConnect tx signing helpers
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

## Getting Started

### Prerequisites

1. Node.js 18+ (recommended)
2. npm 9+

### Install

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Scripts

1. `npm run dev`: start Vite dev server
2. `npm run build`: create production build
3. `npm run preview`: preview production build locally

## Usage Guide

### 1) Create or Import Wallet

1. Open wallet selector
2. Choose create/import
3. Pick wallet type (single or HD)
4. For import, provide seed phrase and derivation path
5. Activate wallet

### 2) Receive Funds

1. Tap receive button
2. Choose BCH or CashToken address type
3. Copy address or share QR

### 3) Send Funds

1. Open send action from asset card
2. Select BCH or token mode
3. Enter destination and amount
4. Confirm send request

### 4) Pair WalletConnect

1. Open WalletConnect modal
2. Paste a WalletConnect URI
3. Pair and review incoming connection proposal
4. Approve or reject

### 5) Notifications

1. Open footer bell icon
2. Review unread events
3. Mark all as read if needed
4. Adjust notification type toggles in wallet settings

## Storage and Persistence

Purze uses browser-local persistence for UX speed and offline-like continuity.

Primary persisted data includes:
1. Wallet records/state (via mainnet-js + IndexedDB provider)
2. Token metadata cache
3. USD rate cache
4. Hidden/favorite token category preferences
5. Notification settings and event history

No server-side backend is required for core wallet UI behavior.

## Security and Privacy Notes

1. Wallet data is local-device scoped in browser storage.
2. Always back up seed phrases securely outside the browser.
3. Verify recipient addresses before sending.
4. Treat any dApp connection as a trust decision.
5. Review WalletConnect requests carefully before approval.

### Open-Source Readiness Checklist

Before publishing publicly, verify:
1. No `.env` or key files are committed.
2. No private keys, seed phrases, tokens, or credentials are hardcoded.
3. No sensitive debug logs are committed.
4. Repo has a license file that matches your intent.
5. README and contribution guidance are up to date.

## Configuration Notes

The app currently defines a WalletConnect project ID constant in source.

For stricter deployment hygiene, consider moving this to environment configuration in a follow-up, then reading it from `import.meta.env`.

## Development Guidelines

1. Keep UI compact but readable on small screens.
2. Preserve one-tap actions for core wallet flows.
3. Validate builds after UI/state changes.
4. Prefer explicit approval flows over implicit behavior for signing actions.

## Contributing

1. Fork repository
2. Create feature branch
3. Implement changes with build verification
4. Open pull request with concise change summary

## Disclaimer

This software is provided as-is. Use at your own risk. You are responsible for key management, wallet backups, and transaction verification.
