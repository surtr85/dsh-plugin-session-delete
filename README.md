# dsh-plugin-session-delete / Session Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DSH-Plugin-success)](https://github.com/deepseek-ai/deepseek-harness)

Comprehensive **Session Manager & Live Eraser** for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness):
1. **Dedicated Settings Tab**: Injects a high-density **"Session Manager"** dashboard into the Settings panel directly below *Agent presets* (`settings.section`, order `25`).
2. **Zero-Lock Live Reactivity**: Erasing, archiving, pinning, or renaming sessions updates the UI instantly in real time via Cordis WebSocket broadcasts (`api-session/removed`) without requiring any service restarts or browser reloads.
3. **Workspace Hierarchy & Ungrouped Sessions**: Organizes sessions strictly by workspace with collapsible trees, plus dedicated groups for ungrouped and archived sessions.
4. **Multi-Select & Bulk Operations**: Checkbox multi-selection with bulk deletion, bulk archiving, and bulk restoration.
5. **Full Lifecycle Controls**: Rename, Fork, Pin/Unpin, Archive/Restore, Ungroup, and Permanent Delete.
6. **Sidebar Context Menu**: Injects a live "Delete session" action with safety confirmation into session row menus (`sidebar.workspaces.session.menu.item`).
7. **Agent Tool & API**: Equips AI agents with `session_delete` and provides `/dsh-ext/session-delete` and `/dsh-ext/session-bulk-delete` endpoints.

---

## ⚡ Why This Plugin?

By default, DeepSeek Harness only supports **Archive session**, keeping all session logs and database records on disk indefinitely, and offers no centralized manager or bulk tools.

This plugin extends DSH using its official **Cordis** slot architecture, **WebServer** routes, and reactive client hooks to provide a complete session control plane.

---

## 🛠 Features & Architecture

### 1. Settings Dashboard (`settings.section`)
Registered right under *Agent presets*:
- **Overview & Stats**: Total sessions, active workspaces, pinned, and archived counts.
- **Instant Search / Filtering**: Filter across titles, session IDs, and directory paths.
- **Views**: *All Sessions*, *Workspaces*, *Ungrouped*, *Pinned*, and *Archived*.
- **Workspace Actions**: Inline rename and ungrouping.
- **Session Actions**: Open, Rename, Fork, Pin, Archive, and Permanent Delete.

### 2. Live Runtime Eviction & Event Bus
When deleting a session:
- Live agent fibers and memory sessions are safely disposed.
- `workspaceRegistry` memberships, pins, and archives are cleaned up.
- Cordis emits `api-session/removed` to notify all connected clients over WebSockets.
- Files under `~/.dsh/sessions/`, `~/.dsh/recovery/`, and projection caches are wiped from disk.
- If deleting the currently active session, the UI smoothly navigates to a new blank session to avoid locks.

---

## 📦 Installation

### 1. Add to your DSH Web Profile

Navigate to `~/.dsh/profiles/web`:

```bash
cd ~/.dsh/profiles/web
```

Add or link the dependency in `package.json`:

```json
{
  "dependencies": {
    "dsh-plugin-session-delete": "github:surtr85/dsh-plugin-session-delete"
  }
}
```

Or install via pnpm:

```bash
pnpm add github:surtr85/dsh-plugin-session-delete
```

### 2. Register in `cordis.patch.yml`

```yaml
- insert:
    - id: plugin-session-delete
      name: "dsh-plugin-session-delete"
```

---

## 💻 CLI Usage

```bash
# Delete a session by ID
npx dsh-delete session-3090573d-2edd-4f3f-b4f8-3fb9f6e70f20
```

---

## 🧪 Testing

```bash
npm test
```

---

## 📄 License

MIT © [Sajjad (surtr85)](https://github.com/surtr85)
