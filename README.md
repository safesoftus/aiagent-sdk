# Convoso AI Agent SDKs

Open-source client libraries for embedding a Convoso AI agent in your own product: voice and chat over WebRTC / WebSocket, in the browser, in React, in React Native, or as a drop-in widget.

| Package | Install | Guide |
|---|---|---|
| `@convoso/ai-agent` — core client (browser + Node) | `npm i @convoso/ai-agent` | [docs/sdk-javascript.md](docs/sdk-javascript.md) |
| `@convoso/ai-agent-react` — hooks and components | `npm i @convoso/ai-agent-react` | [docs/sdk-react.md](docs/sdk-react.md) |
| `@convoso/ai-agent-react-native` — Expo / RN | `npm i @convoso/ai-agent-react-native` | [docs/sdk-react-native.md](docs/sdk-react-native.md) |
| `@convoso/ai-agent-widget` — embeddable `<script>` widget | `<script src="…/widget.js">` | [docs/sdk-widget.md](docs/sdk-widget.md) |

Mobile integration notes: [docs/agent-mobile-integration.md](docs/agent-mobile-integration.md). Examples: [packages/examples](packages/examples) (Vite + React, Expo).

## Develop

```bash
npm install
npm run build        # every package (esbuild)
npm test             # every package
npm run size         # bundle size budget
```

Node 20 or newer. Releases use [changesets](.changeset/README.md): add a changeset with your change, a "Version Packages" PR is opened, and publishing runs from the release workflow after it merges.

## Licence

MIT — see [LICENSE](LICENSE). The packages talk to your Convoso account through the Convoso AI Agent API; an API key from your Convoso dashboard is required to run them.
