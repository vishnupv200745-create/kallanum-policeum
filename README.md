# കള്ളനും പോലീസും — Multiplayer

## Features
- Express + Socket.IO multiplayer rooms.
- Up to 15 players per room.
- Malayalam role names on the secret paper card.
- Paper/glass shake animation and a simple generated paper-shuffle sound.
- Optional room voice chat using WebRTC: push-to-talk or always-on microphone.
- Voice chat requires microphone permission and HTTPS (Render provides HTTPS).

## Run locally
1. Install Node.js 18 or later.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Voice chat notes
Each participant must select a voice mode and click **മൈക്രോഫോൺ ഓൺ ചെയ്യുക**. Push-to-talk requires holding the talk button. Always-on mode sends microphone audio continuously. Browser microphone permission is required. The current peer-to-peer voice setup uses a public STUN server; some restrictive networks may require a TURN server for reliable connectivity.

## Deploy
Push the updated files to the GitHub repository connected to Render. Wait for Render to finish deployment, then test with two or more devices. These files do not update the live website until deployed.
