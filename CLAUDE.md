# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm run dev` - Start the development server on http://localhost:3000
- `npm run build` - Build the Next.js application for production
- `npm start` - Start the production server
- `npm run lint` - Run ESLint for code quality checks

## Application Architecture

This is an AI-powered podcast generation application built with Next.js 15 that converts web content into conversational podcasts with synthesized audio.

### Core Processing Pipeline

The application follows a three-stage pipeline:
1. **Web Scraping** (`/api/scrape`) - Uses Firecrawl to extract content from URLs
2. **Conversation Generation** (`/api/generate-podcast`) - Uses OpenAI's gpt-5-mini to create dialogue
3. **Audio Synthesis** (`/api/text-to-speech`) - Uses ElevenLabs to convert text to speech

### Key Architectural Components

**Frontend (`src/app/page.tsx`)**
- Single-page React application with three independent steps: Extract, Generate Dialogue, Generate Audio
- Each step can be triggered independently — no need to restart from scraping
- Podcast style selector: short (3-5 min), medium (10-15 min, pedagogical), long (30-35 min, deep)
- Editable dialogue: each conversation turn can be modified before audio generation
- Uses two French ElevenLabs voices: Sophie and Marc

**API Routes (`src/app/api/`)**
- `/api/scrape` - Firecrawl integration for web content extraction (markdown format, main content only)
- `/api/generate-podcast` - OpenAI integration for conversation generation using streaming structured output
- `/api/text-to-speech` - ElevenLabs Text-to-Dialogue API integration with dialogue creation

**Server Actions (`src/actions/dialogue.ts`)**
- Handles ElevenLabs dialogue creation with proper error handling
- Automatic batching: splits long conversations into chunks under 2800 chars for ElevenLabs API compliance
- Concatenates audio from multiple batches for seamless playback
- Implements Result pattern for type-safe error handling

**Utilities (`src/app/actions/utils.ts`)**
- ElevenLabs client initialization and configuration
- Stream processing utilities for audio data conversion
- Centralized error handling functions

**Types (`src/types/index.ts`)**
- `DialogueInput` - Defines voice and text pairs for synthesis
- `CreateDialogueRequest` - API request structure for dialogue generation
- `Result<T>` - Functional error handling pattern

### AI Model Configuration

**OpenAI Integration:**
- Model: `gpt-5-mini` via `@ai-sdk/openai`
- Uses `streamObject` with Zod schema for structured conversation output with streaming support
- Schema enforces Speaker1/Speaker2 pattern with natural speech annotations
- Conversation generation is streamed in real-time to the frontend

**Conversation Schema:**
```typescript
conversation: z.array(
  z.object({
    speaker: z.enum(["Speaker1", "Speaker2"]),
    text: z.string().describe("The text spoken by this speaker, including natural speech patterns and nuances like [laughs], [pauses], [excited], etc.")
  })
)
```

**Podcast Styles (selectable by user):**
- **Short** (3-5 min): ~2500 chars, 8-12 exchanges, focused on most fascinating aspect
- **Medium** (10-15 min): ~6000-8000 chars, 20-30 exchanges, pedagogical with clear explanations
- **Long** (30-35 min): ~20000-25000 chars, 60-80 exchanges, deep exploration of all angles

**Conversation Style:**
- Optimized for dynamic, natural conversations with interruptions and emotional reactions
- Uses em dashes (—) for mid-sentence interruptions and overlapping dialogue
- ElevenLabs v3 audio tags: [laughs], [thoughtful], [excited], [sighs], [pauses], [whispers]

### Environment Variables

Required environment variables:
- `OPENAI_API_KEY` - OpenAI API key for conversation generation
- `FIRECRAWL_API_KEY` - Firecrawl API key for web scraping
- `ELEVENLABS_API_KEY` - ElevenLabs API key for text-to-speech

### Error Handling Pattern

The codebase uses a functional Result pattern:
- `Result<T> = { ok: true; value: T } | { ok: false; error: string }`
- `Ok(value)` and `Err(error)` helper functions
- Consistent error handling across API routes and server actions

### Voice Configuration

Two hardcoded French ElevenLabs voices are used:
- Speaker1: Sophie (`or4EV8aZq78KWcXw48wd`)
- Speaker2: Marc (`cTNP6ZM2mLTKj2BFhxEh`)

The application maps Speaker1 to the first voice and Speaker2 to the second voice for consistent character assignment in generated podcasts.

### Technical Notes

- ElevenLabs dialogue generation has a 3000-character limit per API call; long conversations are automatically batched
- The application uses streaming for real-time conversation generation from OpenAI
- Firecrawl extracts only main content in markdown format for cleaner podcast input
- Error handling follows functional Result pattern throughout the codebase
- Never start the dev server yourself