# RSI Agent

## Local development

Install dependencies once in `backend/` and `frontend/` with `npm ci`, then run from the repository root:

```sh
./scripts/dev.sh start
./scripts/dev.sh status
./scripts/dev.sh stop
```

The script starts the local MySQL container, backend, and frontend. Open `http://127.0.0.1:5273/`. It creates `backend/.env` from the example if needed and generates a local config encryption key. Add provider connections and API keys in the Models tab, or supply deployment credentials for known Pi providers. Logs are in `.run/`. Docker Compose, Node.js 22.19+, and curl are required. Stopping preserves the MySQL data volume.

- [Backend](backend/README.md): TypeScript agent runtime, Pi AI integration, MySQL persistence, and the run API. Run its commands from `backend/`.
- [Frontend](frontend/README.md): React and assistant-ui client.

System contracts and task records live under [docs](docs/).
