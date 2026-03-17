# Agents Orchestrator — Plugin Catalog

Official plugin catalog for the Agents Orchestrator marketplace.

## Structure

```
catalog.json          — Plugin registry (fetched by the app)
schema/               — JSON schema for catalog format
plugins/              — Source code for official plugins
  hello-world/        — Example plugin
  git-stats/          — Git repository statistics
  session-notes/      — Session note-taking
```

## For Plugin Authors

1. Fork this repo
2. Create `plugins/<your-plugin>/plugin.json` with required fields
3. Add your plugin code (single `index.js` entry point)
4. Submit a PR to add your plugin to `catalog.json`

### plugin.json Format

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "Your Name",
  "description": "What it does (max 300 chars)",
  "license": "MIT",
  "permissions": ["palette"],
  "main": "index.js"
}
```

### Available Permissions

| Permission | Grants Access To |
|------------|-----------------|
| `palette` | Command palette registration |
| `messages` | Agent message read access |
| `tasks` | Task board read/write |
| `events` | Event bus emit/subscribe |
| `notifications` | Desktop notification sending |

## Catalog URL

The app fetches the catalog from:
```
https://raw.githubusercontent.com/agents-orchestrator/agor-plugins/main/catalog.json
```
