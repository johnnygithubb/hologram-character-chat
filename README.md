# THE ETERNAL DIALOGUE

A minimalist monochrome holographic art installation and observation terminal where two distinct artificial intelligences—**THE SEEKER** and **THE SKEPTIC**—engage in a continuous philosophical conversation inside a pure black digital void.

---

## Architecture

- **3D Holographic Stage (`/src/three/hologramHead.ts`, `/src/components/HologramStage.tsx`)**: Two sculpted procedural Three.js AI busts facing one another in a `#000000` void, rendered in grayscale silver, graphite, and white with Fresnel rim shaders, volumetric scanlines, contour lattices, floating point clouds, micro-glitch displacement, and speech-reactive jaw/aura illumination.
- **Codec Dialogue Terminal (`/src/components/CodecDialogueBox.tsx`)**: A stark monochrome Codec-style dialogue window positioned beneath the two holograms that switches between active speakers and streams thoughts in real time.
- **Autonomous Conversation Engine (`/src/App.tsx`, `/server.ts`)**: Streams responses from OpenRouter via a secure Express SSE proxy (`/api/dialogue/turn`), preserves long-term philosophical continuity through automatic archival summarization (`/api/dialogue/summarize`), and enforces exponential backoff on transient failures.
- **Voice & Transmission Audio (`/src/utils/speech.ts`)**: Optional sentence-buffered Web Speech API synthesis with distinct voice profiles and subtle Web Audio harmonic chimes.

---

## Setup & Installation

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and add your OpenRouter API key:

```bash
cp .env.example .env
```

Edit `.env`:

```env
OPENROUTER_API_KEY=sk-or-v1-your-key-here
SEEKER_MODEL=anthropic/claude-3.5-sonnet
SKEPTIC_MODEL=openai/gpt-4o
PORT=3000
```

> **Security note:** `OPENROUTER_API_KEY` is read exclusively by `server.ts` and is never exposed to the browser client.

### 3. Run Locally

Development mode (Express API + Vite HMR-disabled middleware on port 3000):

```bash
npm run dev
```

Production build and start:

```bash
npm run build
npm start
```

Open `http://localhost:3000`.

---

## Controls & Keyboard Shortcuts

- **Space**: Start / Pause the conversation
- **M**: Mute / Unmute voice synthesis and Codec chimes
- **H**: Hide / Show subtitles & labels (Projection / Black-Mesh Mode)
- **T**: Open / Close the full Transcript Archive (supports `.md` export)
- **Settings icon**: Configure OpenRouter model IDs independently, edit Seeker/Skeptic personas, adjust temperature & turn delay, choose philosophical topics or autonomous evolution, test API connectivity, and inspect token statistics.

---

## Black Mesh Projection Notes

Because the background canvas is pure `#000000` and all holograms and typography use strictly grayscale luminance (`#404040` to `#FFFFFF`), projecting onto fine black theatrical scrim / holo-mesh renders the void transparent while leaving the two busts and active dialogue floating in space. Press **`H`** to toggle pure bust-only projection mode at any time.
