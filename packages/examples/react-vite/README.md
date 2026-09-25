# React sample — @convoso/ai-agent-react

A voice call and a text-only chat (no microphone) with one agent, plus a
thumbs up / down on every agent line. Used by the E4 QA plan
(`docs/qa/agent-integration-e4-qa.md`, section P2).

```bash
# from the repo root, once
npm install
npm run build -w packages/ai-agent -w packages/ai-agent-react
cp packages/examples/react-vite/.env.example packages/examples/react-vite/.env.local   # then edit it
npm run dev -w packages/examples/react-vite     # http://localhost:5173
```

The agent needs **Public access** on (Agent → Settings → Security) and the
page's address (`http://localhost:5173`) in its allowed origins when that list
is set.
