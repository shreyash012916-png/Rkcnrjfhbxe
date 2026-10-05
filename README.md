# ORBITA — Local Mission Control 3.0

ORBITA is a local-first voice mission-control website for a school science exhibition with two physical zones: Agriculture and Industry.

## What changed in 3.0

- No Gemini API, no API key, and no cloud AI dependency for the core agent.
- Natural conversational command handling through the ORBITA Local Core.
- Live-state-aware planning: when asked to create an agriculture plan, ORBITA checks current telemetry first and creates a plan from the systems that are actually available.
- Voice input through the browser SpeechRecognition API when supported.
- Voice output through browser speech synthesis.
- PDF mission-brief upload and local text extraction with PDF.js in the browser; the extracted text is kept in the current session and can be used in conversation.
- Hardware actions remain a small explicit allow-list: pump on/off, auto irrigation on/off, machine on/off, emergency stop.
- Flat deployable project structure with Render support.

## Render

Build command:

`npm install`

Start command:

`npm start`

No `GEMINI_API_KEY` is needed.

## Local

1. Install Node.js 20+.
2. Open this folder in a terminal.
3. Run `npm install`.
4. Run `npm start`.
5. Open `http://localhost:10000`.

On Windows, double-click `start.bat`.

## Hardware configuration

Open **CONFIGURE** in the app and enter the IP addresses reachable from the device running the browser.

The agriculture controller uses:

- `GET /api/status`
- `POST /api/pump` with `{ "on": true|false }`
- `POST /api/auto` with `{ "enabled": true|false }`

The industry controller uses:

- `GET /api/status`
- `POST /api/machine` with `{ "on": true|false }`
- `POST /api/stop`

For direct browser-to-ESP32 control, the browser and ESP32s normally need to be on the same LAN, and the firmware enables CORS.

## Voice

Speech recognition is browser-dependent. Chromium-based browsers are the safest choice for the exhibition. Text input always remains available.

Use **TEST VOICE** before the show.

## PDF brief

Upload an ordinary text-based PDF. ORBITA extracts text in the browser with PDF.js. It does not upload the PDF itself to an AI provider. The first 12,000 extracted characters are retained for the current browser session.

Try commands such as:

- “Hello ORBITA.”
- “Check the agriculture field.”
- “Is the soil dry?”
- “Create a plan for agriculture based on what is available now.”
- “Enable automatic irrigation.”
- “According to the brief, what should agriculture do first?”
- “Give me the full mission status.”
- “Stop the machine.”

## Safety/logic model

ORBITA never invents sensor readings. Physical actions are limited to the explicit action allow-list in `server.js`. The agriculture ESP32 remains responsible for the actual moisture-threshold automation loop.

## Notes on Render vs the school LAN

A Render-hosted web app can serve the interface, but a cloud server generally cannot initiate direct connections to a private school-LAN IP such as `192.168.x.x`. ORBITA therefore makes the hardware calls from the browser. For the most reliable physical exhibition, run ORBITA locally on the control laptop connected to the same Wi-Fi as the ESP32 boards.
