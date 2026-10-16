# Kallanum Policeum — Auto Public Rooms

## Features in this update
- Keeps 10 pre-created public rooms available in the public room list.
- Players can still create their own private or public rooms.
- Auto rooms use real players only; no bots are added or presented as real people.
- Auto rooms start a 10-second countdown after at least 2 real players join.
- Auto rooms run rounds automatically and return to the public room list for the next game.
- Public room list shows room name, player count, rounds, and a Join button; it does not show Waiting/Starting/In Progress badges.
- Maximum room size remains 15 players.

## Run locally
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Deploy
Replace the project files in your GitHub repository with `package.json`, `server.js`, `README.md`, and `public/index.html`, then commit. Render should deploy the connected repository automatically.

## Important limitations
- Rooms and player sessions are stored in server memory. A server restart clears active rooms and recreates the 10 public rooms.
- Public auto rooms require at least 2 real players to start because the Police/Thief game needs both roles.
- This package has syntax checks, but has not been end-to-end tested with multiple real devices. Voice chat still needs real-device testing.
- For reliable 24/7 availability, use an always-on hosting plan; free hosting may sleep.
