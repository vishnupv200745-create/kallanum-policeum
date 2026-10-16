# Kallanum Policeum — Online Multiplayer Game

A responsive browser game for playing Kallanum Policeum with friends. Includes public/private rooms, room codes, live lobby updates, secret roles, paper picking, police suspect selection, rounds, and scores.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000 in your browser.

To test multiplayer locally, open the same URL in two or more browser tabs (use different player names). Rooms are stored in server memory, so they reset if the server restarts.

## Let friends join online

Deploy this folder to a Node.js host that supports persistent WebSocket connections (for example, Render or Railway):
1. Push the project to a private/public GitHub repository.
2. Create a new Web Service from the repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Use the deployed HTTPS URL and share it with friends.

Do not deploy as a static-only site; the Node server and Socket.IO are needed for real-time rooms. Use a host that supports WebSockets and long-running Node processes.

## Rules in this starter version

- Up to 12 players per room; minimum 2 players to start.
- Host chooses 3–30 rounds.
- Every round has one Police and one Thief; additional players receive King, Minister, Detective, and Citizen roles.
- Each player picks a paper once. When everyone has picked, the police gets the suspect list.
- Correct police guess: police gains 2 points. Wrong guess: thief gains 2 points.
- Only the host can start or advance rounds.

## Important limitations / production checklist

This is a working starter project, not a hardened public service. Room data is held in memory and disappears on server restart; a server restart disconnects active games. For a larger public launch, add persistent storage, rate limiting, moderation/reporting, reconnect handling, and stronger anti-cheat controls. The server keeps roles private in Socket.IO events and does not include them in public room updates, but production deployments should add further security review.
