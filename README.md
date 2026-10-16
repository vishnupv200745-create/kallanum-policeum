# Kallanum Policeum

A multiplayer Kallanum Policeum game built with Node.js, Express and Socket.IO.

## Matchmaking configuration
- Maximum **15 real players per room**.
- Quick Play places players in a shared matchmaking queue.
- When at least 2 real players are waiting, a **10-second countdown** begins.
- At the end of the countdown, up to 15 waiting players are grouped into a public Quick Match and the round starts automatically.
- If fewer than 2 players are waiting, matchmaking waits for another real player. No AI players are added.
- Additional waiting players can form another room; each room has its own round and score state.
- Manual private/public room creation and joining with a code remain available.

## Interface language
- Home, room controls, settings, prompts, messages and points are in English.
- Only the role names printed on the paper card are in Malayalam.
- Role points display in English (for example, `100 Points`).
- The Light mode / Dark mode button switches themes and saves the choice in the browser.

## Plan for persistent 24/7 hosting
The app exposes `GET /health` for a health check. For continuous availability, deploy it as an **always-on paid web service** (for example, a Render Starter web service) rather than a free service that may spin down when idle. Configure the service to deploy from the GitHub repository and use the start command `npm start`; Render supplies the `PORT` environment variable automatically.

Important limitations:
- No hosting provider can guarantee uninterrupted 24/7 uptime; use provider health monitoring and review its uptime/service terms.
- Room/player state currently lives in server memory. A restart or redeploy clears active rooms and matchmaking queues. If active rooms must survive server restarts, add a persistent database and shared Socket.IO adapter (such as Redis) before scaling to multiple instances.
- Voice chat requires HTTPS and microphone permission. Test with several real phones/browsers before launch.

## Run locally
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.
