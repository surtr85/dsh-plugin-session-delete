# dsh-plugin-session-delete

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-Plugin-success)](https://github.com/deepseek-ai/deepseek-harness)

Official, lightweight [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) plugin adding full-stack **Session Deletion** capabilities:
1. **Web UI Context Menu**: Injects a native, destructive **"Delete session"** action with confirmation modal into the session dropdown menu (`sidebar.workspaces.session.menu.item`).
2. **Backend API Endpoint**: Mounts `POST /api/session/delete` on DSH's internal WebServer to cleanly shut down active agents and remove session data from disk (`~/.dsh/sessions/`).
3. **Agent Tool**: Equips the coding agent with a native `session_delete` tool for automated housekeeping.
4. **Standalone CLI**: Provides `bin/dsh-delete.mjs` for manual or scripted deletions from terminal.

---

## ⚡ Why This Plugin?

By default, DeepSeek Harness only supports **Archive session**, which keeps all session logs and database records on disk indefinitely. Users wanting to permanently remove sensitive or discarded conversations had no UI option to delete them.

This plugin extends DSH using its official **Cordis** slot architecture and **WebServer** routes to add a seamless delete experience.

---

## 🛠 Architecture

### 1. Web UI Slot Injection
The plugin registers into the `sidebar.workspaces.session.menu.item` slot with `order: 500` (placed directly below *Archive session*):
- Renders `MenuItemButton` with `danger: true`, `separatorBefore: true`, and `IconTrashOutlineRegular`.
- On click, triggers a safety `Modal` confirming permanent deletion.
- Upon confirmation, dispatches to `/api/session/delete` and navigates smoothly away if deleting the active session.

### 2. Host Persistence & Engine Disposal
- Checks authentication via DSH's internal connection layer.
- Resolves and terminates any live agent fiber running for the target session.
- Erases the session log directory (`~/.dsh/sessions/<workspace>/<sessionId>`) and recovery caches.
- DeepSeek Harness SQLite search engine automatically reconciles and purges the deleted record on the next query cycle.

---

## 📦 Installation

### 1. Add to your DSH Web Profile

Navigate to your active DSH profile directory (typically `~/.dsh/profiles/web`):

```bash
cd ~/.dsh/profiles/web
```

Add the dependency in `package.json`:

```json
{
  "dependencies": {
    "dsh-plugin-session-delete": "github:surtr85/dsh-plugin-session-delete"
  }
}
```

Or install via pnpm/npm:

```bash
pnpm add github:surtr85/dsh-plugin-session-delete
```

### 2. Register in `cordis.patch.yml`

Add the plugin to your `~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: plugin-session-delete
      name: "dsh-plugin-session-delete"
```

### 3. Restart DeepSeek Harness

Restart your `dsh web` service:

```bash
dsh web
```

Refresh the browser. Open the `...` menu on any session row in the sidebar — you will now see **Delete session** at the bottom!

---

## 💻 CLI Usage

```bash
# Delete a session by ID
npx dsh-delete session-3090573d-2edd-4f3f-b4f8-3fb9f6e70f20
```

---

## 🧪 Testing

Run the included test suite:

```bash
node --test test/*.test.mjs
```

---

## 📄 License

MIT © [Sajjad (surtr85)](https://github.com/surtr85)
