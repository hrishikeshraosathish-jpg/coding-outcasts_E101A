<!-- Summary: added instructions for running the local Ollama planner server. -->
# Hacktide Navigator Planner Server

## Quick start
```bash
npm install
npm run dev
```

The server runs at `http://localhost:3000` and provides:
- `GET /health` → `{ "ok": true }`
- `POST /plan` → returns the next action JSON

### Environment variables
- `PORT` (default: 3000)
- `OLLAMA_URL` (default: http://localhost:11434)
- `OLLAMA_MODEL` (default: llama3.1:8b)
