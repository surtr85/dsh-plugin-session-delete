/**
 * DeepSeek Harness Web Client Plugin: Session Manager & Live Eraser
 *
 * Provides:
 * 1. Dedicated "Session Manager" Settings tab below Agent Presets (order: 25)
 * 2. Real-time zero-lock session deletion, bulk deletion, archiving, pinning, renaming, and forking
 * 3. Workspaces grouping, Ungrouped sessions, and Archive management
 * 4. Sidebar context menu integration with live update (no reload needed)
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-session-delete",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
  const React = require("react");
  const { useState, useEffect, useMemo, useCallback } = React;

  let primitives = {};
  try {
    primitives = require("@deepseek-ai/dsh-client-ui-primitives") || {};
  } catch {}

  const e = React.createElement;

  // Icons helper fallback if primitive not available
  function renderIcon(name, props = {}) {
    const Component = primitives[name];
    if (Component) {
      return e(Component, { size: props.size || 16, className: props.className });
    }
    return null;
  }

  /**
   * Performs live server-side deletion and reactive client cleanup.
   */
  async function performLiveDelete(sessionId, ctx) {
    // 1. If currently in this session, transition away first to avoid locking
    const isCurrent = typeof window !== "undefined" && window.location.href.includes(sessionId);
    if (isCurrent) {
      const newChatBtn = document.querySelector(
        'button[aria-label*="New session"], button[aria-label*="New Chat"], [data-testid="new-chat-button"]'
      );
      if (newChatBtn) {
        newChatBtn.click();
      } else if (ctx?.sessions && typeof ctx.sessions.create === "function") {
        ctx.sessions.create().catch(() => {});
      }
    }

    // 2. Call server deletion endpoint
    const res = await fetch("/dsh-ext/session-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Server responded with HTTP ${res.status}`);
    }

    // 3. Immediately notify client stores to remove without reload
    if (ctx?.sessions && typeof ctx.sessions.handleSessionRemoved === "function") {
      ctx.sessions.handleSessionRemoved(sessionId);
    }
    if (ctx?.sessions && typeof ctx.sessions.refresh === "function") {
      ctx.sessions.refresh().catch(() => {});
    }

    // 4. Also unpin / unarchive in workspaces if client service is present
    if (ctx?.workspaces) {
      ctx.workspaces.unpinSession?.(sessionId)?.catch?.(() => {});
      ctx.workspaces.unarchiveSession?.(sessionId)?.catch?.(() => {});
    }
  }

  /**
   * Performs bulk deletion across multiple session IDs.
   */
  async function performBulkDelete(sessionIds, ctx) {
    if (!sessionIds || sessionIds.length === 0) return;

    // Check if current session is among them
    const currentIsSelected = sessionIds.some((id) =>
      typeof window !== "undefined" && window.location.href.includes(id)
    );
    if (currentIsSelected) {
      const newChatBtn = document.querySelector(
        'button[aria-label*="New session"], button[aria-label*="New Chat"], [data-testid="new-chat-button"]'
      );
      if (newChatBtn) {
        newChatBtn.click();
      } else if (ctx?.sessions && typeof ctx.sessions.create === "function") {
        ctx.sessions.create().catch(() => {});
      }
    }

    const res = await fetch("/dsh-ext/session-bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionIds }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Server responded with HTTP ${res.status}`);
    }

    // Purge each from client store
    for (const id of sessionIds) {
      if (ctx?.sessions?.handleSessionRemoved) {
        ctx.sessions.handleSessionRemoved(id);
      }
      if (ctx?.workspaces) {
        ctx.workspaces.unpinSession?.(id)?.catch?.(() => {});
        ctx.workspaces.unarchiveSession?.(id)?.catch?.(() => {});
      }
    }

    if (ctx?.sessions?.refresh) {
      ctx.sessions.refresh().catch(() => {});
    }
  }

  /**
   * Session Manager Main Component
   */
  function SessionManagerSection(props) {
    const { ctx, close } = props;

    // Local reactive snapshots
    const [tick, setTick] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [activeTab, setActiveTab] = useState("all"); // 'all' | 'workspaces' | 'ungrouped' | 'archived' | 'pinned'
    const [collapsedWorkspaces, setCollapsedWorkspaces] = useState(new Set());
    const [statusMessage, setStatusMessage] = useState(null);
    const [busyId, setBusyId] = useState(null);
    const [renameModal, setRenameModal] = useState(null); // { type: 'session' | 'workspace', id, currentTitle }
    const [deleteModal, setDeleteModal] = useState(null); // { type: 'single' | 'bulk', ids: [], titles: [] }

    const [fallbackSessions, setFallbackSessions] = useState([]);

    // Fetch sessions directly from server endpoint
    useEffect(() => {
      fetch("/dsh-ext/sessions")
        .then((r) => r.json())
        .then((data) => {
          if (data && data.ok && Array.isArray(data.sessions)) {
            setFallbackSessions(data.sessions);
          }
        })
        .catch(() => {});
    }, [tick]);

    // Subscribe to sessions and workspaces changes
    useEffect(() => {
      const unsubs = [];
      const bump = () => setTick((t) => t + 1);

      if (ctx?.sessions?.list?.subscribe) {
        unsubs.push(ctx.sessions.list.subscribe(bump));
      }
      if (ctx?.workspaces?.list?.subscribe) {
        unsubs.push(ctx.workspaces.list.subscribe(bump));
      }

      return () => {
        unsubs.forEach((unsub) => {
          try {
            unsub();
          } catch {}
        });
      };
    }, [ctx]);

    // Data extraction
    const sessionsSnapshot = useMemo(() => {
      try {
        return ctx?.sessions?.list?.getSnapshot?.() || { ids: [], byId: {} };
      } catch {
        return { ids: [], byId: {} };
      }
    }, [ctx, tick]);

    const workspacesSnapshot = useMemo(() => {
      try {
        return ctx?.workspaces?.list?.getSnapshot?.() || { items: [], pinnedSessionIds: [], archivedSessionIds: [] };
      } catch {
        return { items: [], pinnedSessionIds: [], archivedSessionIds: [] };
      }
    }, [ctx, tick]);

    const pinnedSet = useMemo(() => new Set(workspacesSnapshot.pinnedSessionIds || []), [workspacesSnapshot]);
    const archivedSet = useMemo(() => new Set(workspacesSnapshot.archivedSessionIds || []), [workspacesSnapshot]);

    // Build normalized sessions list
    const allSessions = useMemo(() => {
      const list = [];
      const ids = sessionsSnapshot.ids || [];
      const byId = sessionsSnapshot.byId || {};

      if (ids.length === 0 && fallbackSessions.length > 0) {
        return fallbackSessions.map((s) => ({
          ...s,
          isPinned: pinnedSet.has(s.id),
          isArchived: archivedSet.has(s.id),
        }));
      }

      for (const id of ids) {
        const item = byId[id] || {};
        list.push({
          id,
          title: item.title || item.displayTitle || id,
          displayTitle: item.displayTitle || item.title || id,
          updatedAt: item.updatedAt || 0,
          cwd: item.cwd || "",
          running: !!item.running,
          isPinned: pinnedSet.has(id),
          isArchived: archivedSet.has(id),
        });
      }
      return list;
    }, [sessionsSnapshot, fallbackSessions, pinnedSet, archivedSet]);

    // Filter by search query
    const filteredSessions = useMemo(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!q) return allSessions;
      return allSessions.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.displayTitle.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.cwd.toLowerCase().includes(q)
      );
    }, [allSessions, searchQuery]);

    const filteredMap = useMemo(() => {
      const map = new Map();
      for (const s of filteredSessions) {
        map.set(s.id, s);
      }
      return map;
    }, [filteredSessions]);

    // Grouping into workspaces
    const { workspaceGroups, ungroupedSessions } = useMemo(() => {
      const accounted = new Set();
      const groups = [];

      for (const ws of workspacesSnapshot.items || []) {
        const wsSessions = [];
        for (const sid of ws.sessionIds || []) {
          accounted.add(sid);
          const s = filteredMap.get(sid);
          if (s) wsSessions.push(s);
        }

        groups.push({
          id: ws.id,
          title: ws.title || ws.path,
          path: ws.path,
          sessions: wsSessions,
          totalCount: (ws.sessionIds || []).length,
        });
      }

      const ungrouped = [];
      for (const s of filteredSessions) {
        if (!accounted.has(s.id)) {
          ungrouped.push(s);
        }
      }

      return { workspaceGroups: groups, ungroupedSessions: ungrouped };
    }, [workspacesSnapshot, filteredSessions, filteredMap]);

    // Quick stats
    const stats = useMemo(() => {
      return {
        total: allSessions.length,
        workspaces: (workspacesSnapshot.items || []).length,
        pinned: pinnedSet.size,
        archived: archivedSet.size,
      };
    }, [allSessions, workspacesSnapshot, pinnedSet, archivedSet]);

    // Selection helpers
    const toggleSelect = useCallback((id) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    }, []);

    const selectAllVisible = useCallback(() => {
      setSelectedIds(new Set(filteredSessions.map((s) => s.id)));
    }, [filteredSessions]);

    const deselectAll = useCallback(() => {
      setSelectedIds(new Set());
    }, []);

    const toggleWorkspaceCollapse = useCallback((wsId) => {
      setCollapsedWorkspaces((prev) => {
        const next = new Set(prev);
        if (next.has(wsId)) next.delete(wsId);
        else next.add(wsId);
        return next;
      });
    }, []);

    // Actions
    const handleSwitchSession = useCallback(
      (sessionId) => {
        try {
          window.location.hash = `#/session/${sessionId}`;
          const currentUrl = new URL(window.location.href);
          currentUrl.searchParams.set("session", sessionId);
          window.history.pushState({}, "", currentUrl.toString());
          if (typeof close === "function") close();
        } catch {}
      },
      [close]
    );

    const handlePin = useCallback(
      async (sessionId) => {
        if (!ctx?.workspaces) return;
        setBusyId(sessionId);
        try {
          if (pinnedSet.has(sessionId)) {
            await ctx.workspaces.unpinSession(sessionId);
          } else {
            await ctx.workspaces.pinSession(sessionId);
          }
        } catch (err) {
          setStatusMessage(`Pin action failed: ${err.message}`);
        } finally {
          setBusyId(null);
        }
      },
      [ctx, pinnedSet]
    );

    const handleArchive = useCallback(
      async (sessionId) => {
        if (!ctx?.workspaces) return;
        setBusyId(sessionId);
        try {
          if (archivedSet.has(sessionId)) {
            await ctx.workspaces.unarchiveSession(sessionId);
          } else {
            await ctx.workspaces.archiveSession(sessionId);
          }
        } catch (err) {
          setStatusMessage(`Archive action failed: ${err.message}`);
        } finally {
          setBusyId(null);
        }
      },
      [ctx, archivedSet]
    );

    const handleFork = useCallback(
      async (sessionId) => {
        if (!ctx?.sessions) return;
        setBusyId(sessionId);
        try {
          const res = await ctx.sessions.fork({ sessionId, increaseTitle: true });
          if (res?.ok && res?.value?.sessionId) {
            setStatusMessage(`Forked successfully into "${res.value.sessionId}".`);
            handleSwitchSession(res.value.sessionId);
          } else {
            setStatusMessage(`Fork failed: ${res?.error?.message || "unknown error"}`);
          }
        } catch (err) {
          setStatusMessage(`Fork failed: ${err.message}`);
        } finally {
          setBusyId(null);
        }
      },
      [ctx, handleSwitchSession]
    );

    const handleRenameSubmit = useCallback(async () => {
      if (!renameModal) return;
      const { type, id, title } = renameModal;
      const trimmed = (title || "").trim();
      if (!trimmed) return;

      setBusyId(id);
      try {
        if (type === "session") {
          await ctx.sessions.using(id, { source: "workspaceOperation" }, (ref) =>
            ref.binding.session.rename(trimmed)
          );
          setStatusMessage(`Renamed session to "${trimmed}".`);
        } else if (type === "workspace") {
          await ctx.workspaces.rename(id, trimmed);
          setStatusMessage(`Renamed workspace to "${trimmed}".`);
        }
      } catch (err) {
        setStatusMessage(`Rename failed: ${err.message}`);
      } finally {
        setBusyId(null);
        setRenameModal(null);
      }
    }, [ctx, renameModal]);

    const handleDeleteSubmit = useCallback(async () => {
      if (!deleteModal) return;
      const { type, ids } = deleteModal;
      setBusyId("deleting");

      try {
        if (type === "single" && ids[0]) {
          await performLiveDelete(ids[0], ctx);
          setStatusMessage(`Session ${ids[0]} permanently erased.`);
        } else if (type === "bulk") {
          await performBulkDelete(ids, ctx);
          setStatusMessage(`${ids.length} sessions permanently erased.`);
          setSelectedIds(new Set());
        }
      } catch (err) {
        setStatusMessage(`Delete failed: ${err.message}`);
      } finally {
        setBusyId(null);
        setDeleteModal(null);
      }
    }, [ctx, deleteModal]);

    const handleDeleteWorkspace = useCallback(
      async (workspaceId, wsTitle) => {
        const confirmed = window.confirm(
          `Remove workspace grouping "${wsTitle}"?\n\nSessions inside will be preserved under Ungrouped.`
        );
        if (!confirmed) return;
        setBusyId(workspaceId);
        try {
          await ctx.workspaces.delete(workspaceId);
          setStatusMessage(`Workspace "${wsTitle}" removed. Sessions ungrouped.`);
        } catch (err) {
          setStatusMessage(`Failed to delete workspace: ${err.message}`);
        } finally {
          setBusyId(null);
        }
      },
      [ctx]
    );

    // Format timestamp
    const formatTime = (ts) => {
      if (!ts) return "";
      try {
        const date = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        if (diffMins < 1) return "Just now";
        if (diffMins < 60) return `${diffMins}m ago`;
        const diffHours = Math.floor(diffMins / 60);
        if (diffHours < 24) return `${diffHours}h ago`;
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
      } catch {
        return "";
      }
    };

    // Render individual session row
    const renderSessionRow = (session) => {
      const isSelected = selectedIds.has(session.id);
      const isBusy = busyId === session.id;

      return e(
        "div",
        {
          key: session.id,
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 12px",
            borderBottom: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.06))",
            backgroundColor: isSelected ? "var(--color-bg-subtle, rgba(255, 255, 255, 0.05))" : "transparent",
            transition: "background-color 0.15s ease",
            opacity: isBusy ? 0.5 : 1,
          },
        },
        // Left: checkbox + title + badges
        e(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "10px",
              flex: 1,
              minWidth: 0,
            },
          },
          e("input", {
            type: "checkbox",
            checked: isSelected,
            onChange: () => toggleSelect(session.id),
            style: { cursor: "pointer", accentColor: "var(--color-primary-base, #3b82f6)" },
          }),
          e(
            "button",
            {
              type: "button",
              onClick: () => handlePin(session.id),
              title: session.isPinned ? "Unpin session" : "Pin session",
              style: {
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px",
                color: session.isPinned ? "#f59e0b" : "var(--color-text-secondary, #888)",
                display: "flex",
                alignItems: "center",
              },
            },
            renderIcon(session.isPinned ? "IconPinOutlineMedium" : "IconPinOffOutlineMedium", { size: 14 }) ||
              (session.isPinned ? "★" : "☆")
          ),
          e(
            "div",
            {
              style: {
                display: "flex",
                flexDirection: "column",
                flex: 1,
                minWidth: 0,
                cursor: "pointer",
              },
              onClick: () => handleSwitchSession(session.id),
              title: `Open: ${session.displayTitle}\nID: ${session.id}\nPath: ${session.cwd}`,
            },
            e(
              "div",
              {
                style: {
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  overflow: "hidden",
                },
              },
              e(
                "span",
                {
                  style: {
                    fontWeight: 500,
                    fontSize: "13px",
                    color: "var(--color-text-primary, #e5e5e5)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  },
                },
                session.displayTitle
              ),
              session.running &&
                e(
                  "span",
                  {
                    style: {
                      fontSize: "10px",
                      padding: "1px 5px",
                      borderRadius: "10px",
                      backgroundColor: "rgba(16, 185, 129, 0.2)",
                      color: "#10b981",
                      fontWeight: 600,
                    },
                  },
                  "Active"
                ),
              session.isArchived &&
                e(
                  "span",
                  {
                    style: {
                      fontSize: "10px",
                      padding: "1px 5px",
                      borderRadius: "10px",
                      backgroundColor: "rgba(107, 114, 128, 0.25)",
                      color: "#9ca3af",
                      fontWeight: 500,
                    },
                  },
                  "Archived"
                )
            ),
            e(
              "span",
              {
                style: {
                  fontSize: "11px",
                  color: "var(--color-text-secondary, #737373)",
                  fontFamily: "monospace",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                },
              },
              `${session.id.slice(0, 16)}… • ${formatTime(session.updatedAt)}`
            )
          )
        ),
        // Right: Action buttons
        e(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "4px",
            },
          },
          // Rename button
          e(
            "button",
            {
              type: "button",
              title: "Rename",
              onClick: () =>
                setRenameModal({
                  type: "session",
                  id: session.id,
                  title: session.title,
                }),
              style: actionButtonStyle,
            },
            renderIcon("IconEditOutlineMedium", { size: 14 }) || "✎"
          ),
          // Fork button
          e(
            "button",
            {
              type: "button",
              title: "Fork session",
              onClick: () => handleFork(session.id),
              style: actionButtonStyle,
            },
            renderIcon("IconBranchOutlineMedium", { size: 14 }) || "⑂"
          ),
          // Archive / Unarchive button
          e(
            "button",
            {
              type: "button",
              title: session.isArchived ? "Restore from archive" : "Archive session",
              onClick: () => handleArchive(session.id),
              style: actionButtonStyle,
            },
            renderIcon("IconArchiveOutlineMedium", { size: 14 }) || "📦"
          ),
          // Delete button
          e(
            "button",
            {
              type: "button",
              title: "Delete permanently",
              onClick: () =>
                setDeleteModal({
                  type: "single",
                  ids: [session.id],
                  titles: [session.displayTitle],
                }),
              style: {
                ...actionButtonStyle,
                color: "var(--color-error-base, #ef4444)",
              },
            },
            renderIcon("IconTrashOutlineMedium", { size: 14 }) || "✕"
          )
        )
      );
    };

    return e(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          height: "100%",
          maxHeight: "80vh",
          padding: "16px 20px",
          color: "var(--color-text-primary, #e5e5e5)",
          fontFamily: "system-ui, -apple-system, sans-serif",
          boxSizing: "border-box",
        },
      },
      // Header Bar
      e(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "14px",
            flexWrap: "wrap",
            gap: "10px",
          },
        },
        e(
          "div",
          null,
          e(
            "h2",
            {
              style: {
                margin: 0,
                fontSize: "18px",
                fontWeight: 600,
                letterSpacing: "-0.01em",
              },
            },
            "Session Manager"
          ),
          e(
            "p",
            {
              style: {
                margin: "4px 0 0",
                fontSize: "12px",
                color: "var(--color-text-secondary, #a3a3a3)",
              },
            },
            `Total: ${stats.total} sessions • ${stats.workspaces} workspaces • ${stats.pinned} pinned • ${stats.archived} archived`
          )
        ),
        // Action Controls
        e(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "8px" } },
          e(
            "button",
            {
              type: "button",
              onClick: () => ctx?.sessions?.refresh?.(),
              style: secondaryButtonStyle,
              title: "Sync latest status with host",
            },
            "Sync Baseline"
          ),
          e(
            "button",
            {
              type: "button",
              onClick: () => {
                ctx?.sessions?.create?.().then((res) => {
                  if (res) handleSwitchSession(res);
                });
              },
              style: primaryButtonStyle,
            },
            "+ New Session"
          )
        )
      ),

      // Notification banner if statusMessage
      statusMessage &&
        e(
          "div",
          {
            style: {
              padding: "8px 12px",
              marginBottom: "12px",
              borderRadius: "6px",
              backgroundColor: "rgba(59, 130, 246, 0.15)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              fontSize: "12px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            },
          },
          e("span", null, statusMessage),
          e(
            "button",
            {
              onClick: () => setStatusMessage(null),
              style: { background: "none", border: "none", cursor: "pointer", color: "#a3a3a3" },
            },
            "✕"
          )
        ),

      // Filter Tabs + Search Row
      e(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "12px",
            marginBottom: "12px",
            flexWrap: "wrap",
          },
        },
        // Filter tabs
        e(
          "div",
          {
            style: {
              display: "flex",
              backgroundColor: "var(--color-bg-surface, rgba(255, 255, 255, 0.04))",
              borderRadius: "8px",
              padding: "2px",
              border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
            },
          },
          [
            { id: "all", label: `All (${allSessions.length})` },
            { id: "workspaces", label: `Workspaces (${workspaceGroups.length})` },
            { id: "ungrouped", label: `Ungrouped (${ungroupedSessions.length})` },
            { id: "pinned", label: `Pinned (${stats.pinned})` },
            { id: "archived", label: `Archived (${stats.archived})` },
          ].map((tab) =>
            e(
              "button",
              {
                key: tab.id,
                type: "button",
                onClick: () => setActiveTab(tab.id),
                style: {
                  background: activeTab === tab.id ? "var(--color-bg-base, rgba(255, 255, 255, 0.12))" : "none",
                  border: "none",
                  borderRadius: "6px",
                  padding: "4px 10px",
                  fontSize: "12px",
                  fontWeight: activeTab === tab.id ? 600 : 400,
                  color:
                    activeTab === tab.id
                      ? "var(--color-text-primary, #ffffff)"
                      : "var(--color-text-secondary, #a3a3a3)",
                  cursor: "pointer",
                },
              },
              tab.label
            )
          )
        ),
        // Search Input
        e("input", {
          type: "text",
          placeholder: "Filter sessions by title, ID, path…",
          value: searchQuery,
          onChange: (ev) => setSearchQuery(ev.target.value),
          style: {
            padding: "6px 12px",
            borderRadius: "6px",
            border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.12))",
            backgroundColor: "var(--color-bg-surface, rgba(0, 0, 0, 0.2))",
            color: "var(--color-text-primary, #ffffff)",
            fontSize: "12px",
            outline: "none",
            width: "220px",
          },
        })
      ),

      // Bulk Action Floating / Sticky Bar when selections exist
      selectedIds.size > 0 &&
        e(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 14px",
              marginBottom: "12px",
              borderRadius: "8px",
              backgroundColor: "rgba(59, 130, 246, 0.12)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              fontSize: "13px",
            },
          },
          e(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "10px" } },
            e("span", { style: { fontWeight: 600 } }, `${selectedIds.size} session(s) selected`),
            e(
              "button",
              {
                type: "button",
                onClick: deselectAll,
                style: {
                  background: "none",
                  border: "none",
                  color: "var(--color-text-secondary, #93c5fd)",
                  cursor: "pointer",
                  fontSize: "12px",
                  textDecoration: "underline",
                },
              },
              "Deselect all"
            )
          ),
          e(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "8px" } },
            e(
              "button",
              {
                type: "button",
                onClick: async () => {
                  const toArchive = [...selectedIds];
                  for (const sid of toArchive) {
                    await ctx?.workspaces?.archiveSession?.(sid)?.catch?.(() => {});
                  }
                  setStatusMessage(`Archived ${toArchive.length} sessions.`);
                  deselectAll();
                },
                style: secondaryButtonStyle,
              },
              "Archive Selected"
            ),
            e(
              "button",
              {
                type: "button",
                onClick: async () => {
                  const toUnarchive = [...selectedIds];
                  for (const sid of toUnarchive) {
                    await ctx?.workspaces?.unarchiveSession?.(sid)?.catch?.(() => {});
                  }
                  setStatusMessage(`Restored ${toUnarchive.length} sessions from archive.`);
                  deselectAll();
                },
                style: secondaryButtonStyle,
              },
              "Unarchive Selected"
            ),
            e(
              "button",
              {
                type: "button",
                onClick: () =>
                  setDeleteModal({
                    type: "bulk",
                    ids: [...selectedIds],
                    titles: [...selectedIds].map(
                      (id) => allSessions.find((s) => s.id === id)?.displayTitle || id
                    ),
                  }),
                style: {
                  ...primaryButtonStyle,
                  backgroundColor: "var(--color-error-base, #dc2626)",
                  borderColor: "transparent",
                },
              },
              `Delete Selected (${selectedIds.size})`
            )
          )
        ),

      // Scrollable Sessions List Container
      e(
        "div",
        {
          style: {
            flex: 1,
            overflowY: "auto",
            borderRadius: "8px",
            border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.08))",
            backgroundColor: "var(--color-bg-surface, rgba(0, 0, 0, 0.15))",
          },
        },
        // Active view rendering
        activeTab === "pinned"
          ? e(
              "div",
              null,
              filteredSessions.filter((s) => s.isPinned).length === 0
                ? e("div", { style: emptyStateStyle }, "No pinned sessions found.")
                : filteredSessions.filter((s) => s.isPinned).map(renderSessionRow)
            )
          : activeTab === "archived"
          ? e(
              "div",
              null,
              filteredSessions.filter((s) => s.isArchived).length === 0
                ? e("div", { style: emptyStateStyle }, "No archived sessions.")
                : filteredSessions.filter((s) => s.isArchived).map(renderSessionRow)
            )
          : activeTab === "ungrouped"
          ? e(
              "div",
              null,
              ungroupedSessions.length === 0
                ? e("div", { style: emptyStateStyle }, "No ungrouped sessions.")
                : ungroupedSessions.map(renderSessionRow)
            )
          : // 'all' or 'workspaces' view: Workspaces with accordion + Ungrouped
            e(
              "div",
              null,
              // Workspaces Accordions
              workspaceGroups.map((ws) => {
                const isCollapsed = collapsedWorkspaces.has(ws.id);
                return e(
                  "div",
                  {
                    key: ws.id,
                    style: {
                      borderBottom: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.1))",
                    },
                  },
                  // Workspace Header Row
                  e(
                    "div",
                    {
                      style: {
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        backgroundColor: "var(--color-bg-base, rgba(255, 255, 255, 0.03))",
                        cursor: "pointer",
                        userSelect: "none",
                      },
                      onClick: () => toggleWorkspaceCollapse(ws.id),
                    },
                    e(
                      "div",
                      { style: { display: "flex", alignItems: "center", gap: "8px" } },
                      e(
                        "span",
                        { style: { color: "#9ca3af", fontSize: "11px" } },
                        isCollapsed ? "▶" : "▼"
                      ),
                      renderIcon("IconBrowseOutlineMedium", { size: 15 }) || "📁",
                      e(
                        "span",
                        {
                          style: {
                            fontWeight: 600,
                            fontSize: "13px",
                            color: "var(--color-text-primary, #ffffff)",
                          },
                        },
                        ws.title
                      ),
                      e(
                        "span",
                        {
                          style: {
                            fontSize: "11px",
                            padding: "1px 6px",
                            borderRadius: "10px",
                            backgroundColor: "rgba(255, 255, 255, 0.08)",
                            color: "#9ca3af",
                          },
                        },
                        `${ws.sessions.length} sessions`
                      )
                    ),
                    // Workspace Action Buttons
                    e(
                      "div",
                      {
                        style: { display: "flex", alignItems: "center", gap: "6px" },
                        onClick: (ev) => ev.stopPropagation(),
                      },
                      e(
                        "button",
                        {
                          type: "button",
                          title: "Rename workspace",
                          onClick: () =>
                            setRenameModal({
                              type: "workspace",
                              id: ws.id,
                              title: ws.title,
                            }),
                          style: actionButtonStyle,
                        },
                        "Rename"
                      ),
                      e(
                        "button",
                        {
                          type: "button",
                          title: "Ungroup workspace (keeps sessions)",
                          onClick: () => handleDeleteWorkspace(ws.id, ws.title),
                          style: { ...actionButtonStyle, color: "#f87171" },
                        },
                        "Ungroup"
                      )
                    )
                  ),
                  // Workspace Session Rows
                  !isCollapsed &&
                    (ws.sessions.length === 0
                      ? e(
                          "div",
                          { style: { padding: "10px 16px", fontSize: "12px", color: "#737373" } },
                          "No matching sessions in this workspace."
                        )
                      : ws.sessions.map(renderSessionRow))
                );
              }),

              // Ungrouped Section
              ungroupedSessions.length > 0 &&
                e(
                  "div",
                  { key: "ungrouped-section" },
                  e(
                    "div",
                    {
                      style: {
                        padding: "10px 14px",
                        backgroundColor: "var(--color-bg-base, rgba(255, 255, 255, 0.02))",
                        fontWeight: 600,
                        fontSize: "12px",
                        color: "#a3a3a3",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      },
                    },
                    `Ungrouped Sessions (${ungroupedSessions.length})`
                  ),
                  ungroupedSessions.map(renderSessionRow)
                )
            )
      ),

      // Rename Modal Dialog
      renameModal &&
        e(
          "div",
          {
            style: modalOverlayStyle,
            onClick: () => setRenameModal(null),
          },
          e(
            "div",
            {
              style: modalBoxStyle,
              onClick: (ev) => ev.stopPropagation(),
            },
            e(
              "h3",
              { style: { margin: "0 0 10px", fontSize: "15px" } },
              `Rename ${renameModal.type === "session" ? "Session" : "Workspace"}`
            ),
            e("input", {
              type: "text",
              value: renameModal.title,
              autoFocus: true,
              onChange: (ev) =>
                setRenameModal((prev) => ({ ...prev, title: ev.target.value })),
              onKeyDown: (ev) => {
                if (ev.key === "Enter") handleRenameSubmit();
                if (ev.key === "Escape") setRenameModal(null);
              },
              style: {
                width: "100%",
                padding: "8px 10px",
                borderRadius: "6px",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                backgroundColor: "rgba(0, 0, 0, 0.3)",
                color: "#fff",
                fontSize: "13px",
                boxSizing: "border-box",
                marginBottom: "14px",
              },
            }),
            e(
              "div",
              { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } },
              e(
                "button",
                {
                  type: "button",
                  onClick: () => setRenameModal(null),
                  style: secondaryButtonStyle,
                },
                "Cancel"
              ),
              e(
                "button",
                {
                  type: "button",
                  onClick: handleRenameSubmit,
                  style: primaryButtonStyle,
                },
                "Save"
              )
            )
          )
        ),

      // Delete Confirmation Modal Dialog
      deleteModal &&
        e(
          "div",
          {
            style: modalOverlayStyle,
            onClick: () => setDeleteModal(null),
          },
          e(
            "div",
            {
              style: modalBoxStyle,
              onClick: (ev) => ev.stopPropagation(),
            },
            e(
              "h3",
              { style: { margin: "0 0 8px", fontSize: "15px", color: "#f87171" } },
              deleteModal.type === "single"
                ? "Permanently Delete Session?"
                : `Permanently Delete ${deleteModal.ids.length} Sessions?`
            ),
            e(
              "p",
              { style: { margin: "0 0 14px", fontSize: "12px", color: "#a3a3a3", lineHeight: 1.5 } },
              "This action cannot be undone. All conversation records, checkpoints, and files on disk will be wiped immediately."
            ),
            deleteModal.type === "single" &&
              e(
                "div",
                {
                  style: {
                    padding: "8px 10px",
                    borderRadius: "6px",
                    backgroundColor: "rgba(255, 255, 255, 0.05)",
                    fontSize: "12px",
                    marginBottom: "14px",
                    fontFamily: "monospace",
                  },
                },
                deleteModal.titles[0] || deleteModal.ids[0]
              ),
            e(
              "div",
              { style: { display: "flex", justifyContent: "flex-end", gap: "8px" } },
              e(
                "button",
                {
                  type: "button",
                  onClick: () => setDeleteModal(null),
                  style: secondaryButtonStyle,
                },
                "Cancel"
              ),
              e(
                "button",
                {
                  type: "button",
                  onClick: handleDeleteSubmit,
                  style: {
                    ...primaryButtonStyle,
                    backgroundColor: "#dc2626",
                    borderColor: "transparent",
                  },
                },
                "Delete Permanently"
              )
            )
          )
        )
    );
  }

  // Styles
  const primaryButtonStyle = {
    padding: "6px 12px",
    borderRadius: "6px",
    backgroundColor: "var(--color-primary-base, #2563eb)",
    color: "#ffffff",
    border: "none",
    fontWeight: 500,
    fontSize: "12px",
    cursor: "pointer",
  };

  const secondaryButtonStyle = {
    padding: "6px 12px",
    borderRadius: "6px",
    backgroundColor: "var(--color-bg-surface, rgba(255, 255, 255, 0.08))",
    border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.12))",
    color: "var(--color-text-primary, #e5e5e5)",
    fontSize: "12px",
    cursor: "pointer",
  };

  const actionButtonStyle = {
    background: "none",
    border: "none",
    padding: "4px 6px",
    borderRadius: "4px",
    cursor: "pointer",
    color: "var(--color-text-secondary, #9ca3af)",
    fontSize: "12px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const emptyStateStyle = {
    padding: "32px 16px",
    textAlign: "center",
    fontSize: "13px",
    color: "var(--color-text-secondary, #737373)",
  };

  const modalOverlayStyle = {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  };

  const modalBoxStyle = {
    width: "400px",
    maxWidth: "90vw",
    backgroundColor: "var(--color-bg-base, #1e1e1e)",
    border: "1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.15))",
    borderRadius: "10px",
    padding: "18px 20px",
    boxShadow: "0 10px 25px rgba(0, 0, 0, 0.5)",
  };

  /**
   * Cordis client plugin application
   */
  function apply(ctx) {
    if (!ctx.slots) return;

    // 1. Register Session Manager section inside Settings modal
    // id: "archived-sessions" uses native IconArchiveOutlineMedium in DSH settings!
    ctx.slots.inject("settings.section", () =>
      ctx.slots.register(
        {
          name: "settings.section",
          id: "archived-sessions",
          order: 25, // Placed right below Agent presets (order 20)
          label: "Session Manager",
        },
        (props) => e(SessionManagerSection, { ...props, ctx })
      )
    );

    // 2. Also register live "Delete session" in sidebar context menu
    ctx.slots.inject("sidebar.workspaces.session.menu.item", () => {
      return ctx.slots.register(
        {
          name: "sidebar.workspaces.session.menu.item",
          id: "delete-session",
          order: 500,
        },
        ({ sessionId, displayTitle, useMenuOpenState }) => {
          const [, setMenuOpen] = typeof useMenuOpenState === "function" ? useMenuOpenState() : [false, () => {}];

          const handleDelete = async () => {
            if (typeof setMenuOpen === "function") setMenuOpen(false);
            const title = displayTitle || "this session";
            const confirmed = window.confirm(
              `Permanently delete "${title}"?\n\nThis will erase all messages and session data from disk and runtime memory. This cannot be undone.`
            );
            if (!confirmed) return;

            try {
              await performLiveDelete(sessionId, ctx);
            } catch (err) {
              window.alert(`Failed to delete session: ${err.message}`);
            }
          };

          return e(
            "button",
            {
              type: "button",
              onClick: handleDelete,
              style: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "8px 12px",
                border: "none",
                background: "none",
                color: "var(--color-error-base, #ff4d4f)",
                fontSize: "13px",
                textAlign: "left",
                cursor: "pointer",
                borderRadius: "4px",
              },
            },
            renderIcon("IconTrashOutlineMedium", { size: 14 }) || "🗑",
            e("span", null, "Delete session")
          );
        }
      );
    });
  }

  exports.name = "dsh-plugin-session-delete";
  exports.inject = ["slots"];
  exports.apply = apply;
  return module.exports;
  }
});
