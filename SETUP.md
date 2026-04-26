# SETUP

## Prerequisites
- Node.js (recommended: Node 20+)
- npm (this repo uses `package-lock.json`, so npm is the default package manager)
- Git
- OpenAI API key (required for syllabus parsing, chat, embeddings, and note generation)

## 1. Clone the repository
```bash
git clone <repo-url>
cd study-agent-mvp
```

## 2. Install dependencies
```bash
npm install
```

## 3. Configure environment variables
This repository does not currently include a `.env.example` file.

Create a `.env.local` file in the project root and add:

```env
OPENAI_API_KEY=your_api_key_here
```

Do not commit real API keys to git.

## 4. Run the development server
```bash
npm run dev
```

Then open:

`http://localhost:3000`

## 5. Build check
```bash
npm run build
```

If build succeeds, your local setup is working correctly.

## 6. Troubleshooting
- **Missing OPENAI_API_KEY**
  - Symptom: API routes return errors like `OPENAI_API_KEY is not set`.
  - Fix: Ensure `.env.local` exists in project root and contains `OPENAI_API_KEY=...`, then restart dev server.

- **Dependency installation problems**
  - Symptom: `npm install` fails or native module build errors appear.
  - Fix: Use a supported Node.js version (Node 20+), then retry `npm install`.

- **Port 3000 already in use**
  - Symptom: dev server cannot start on `localhost:3000`.
  - Fix: stop the process using port 3000, or run on another port (for example: `npx next dev -p 3001`).

- **PDF parsing or upload issues**
  - Symptom: syllabus/lecture PDF uploads fail or return “No text could be extracted”.
  - Fix: verify the file is a text-based PDF (not image-only), re-upload, and check server logs for parsing errors.
