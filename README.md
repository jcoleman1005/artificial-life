# Artificial Life Lab

A personal artificial-life simulation focused on interpretable evolutionary behavior.

## Requirements
- Node.js 20.19+ or 22.12+
- npm
- Git

## Start
```bash
npm install
npm run dev
```

Open the local URL printed by Vite. To test on another device on your LAN, use the Fedora machine's LAN IP and Vite port. Do not expose the development server directly to the public internet.

## Always-on server
```bash
npm run server
```

Builds the app and the server, then runs one world for every viewer at `http://<this machine>:8080`. The world keeps running with nobody watching, is saved to `./data` every 5 minutes and on shutdown, and resumes where it was after a restart. See `docs/server.md` for options and the Galaxy S21 (Termux) setup.

## Checks
```bash
npm run check
npm test
npm run build
```

See `AGENTS.md` and `docs/implementation-plan.md` for project decisions and the initial milestone.

