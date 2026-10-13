/**
 * DeepSeek Harness Web Client Plugin
 * Injects "Delete session" into the session row context menu (sidebar.workspaces.session.menu.item).
 */

function definePlugin(require, exports, module) {
  const React = require("react");
  const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
  const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

  const MenuItemButton = primitives.MenuItemButton;
  const Modal = primitives.Modal;
  const Button = primitives.Button;
  const IconTrashOutlineRegular = primitives.IconTrashOutlineRegular;

  // React state observer for the delete confirmation modal
  const promptListeners = new Set();
  let currentPrompt = null;

  function setPrompt(val) {
    currentPrompt = val;
    for (const listener of promptListeners) {
      try {
        listener(currentPrompt);
      } catch (err) {
        console.error("dsh-plugin-session-delete: listener error", err);
      }
    }
  }

  function useDeletePrompt() {
    const [prompt, set] = React.useState(currentPrompt);
    React.useEffect(() => {
      promptListeners.add(set);
      return () => promptListeners.delete(set);
    }, []);
    return prompt;
  }

  /**
   * Menu Item row (Order 500 - placed after Archive session).
   */
  function DeleteSessionMenuItem({ sessionId, displayTitle, useMenuOpenState }) {
    const [, setMenuOpen] = typeof useMenuOpenState === "function" ? useMenuOpenState() : [false, () => {}];

    const handleSelect = React.useCallback(() => {
      if (typeof setMenuOpen === "function") {
        setMenuOpen(false);
      }
      setPrompt({
        sessionId,
        displayTitle: displayTitle || "Untitled Session",
      });
    }, [sessionId, displayTitle, setMenuOpen]);

    const icon = IconTrashOutlineRegular
      ? jsx(IconTrashOutlineRegular, { size: 14 })
      : jsx("span", { style: { marginRight: 6 }, children: "🗑" });

    return jsx(MenuItemButton, {
      danger: true,
      separatorBefore: true,
      icon,
      onSelect: handleSelect,
      children: "Delete session",
    });
  }

  /**
   * Confirmation Modal Overlay.
   */
  function DeleteSessionModalOverlay() {
    const prompt = useDeletePrompt();
    const [deleting, setDeleting] = React.useState(false);
    const [error, setError] = React.useState(null);

    if (!prompt) return null;

    const close = () => {
      if (deleting) return;
      setError(null);
      setPrompt(null);
    };

    const confirm = async () => {
      setDeleting(true);
      setError(null);
      try {
        const response = await fetch("/api/session/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: prompt.sessionId }),
        });

        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data.error || `HTTP ${response.status}: Failed to delete session`);
        }

        // Check if currently active session was deleted
        const isCurrentSession = window.location.href.includes(prompt.sessionId);

        setPrompt(null);

        // If viewing deleted session, navigate to home/new session
        if (isCurrentSession) {
          const newSessionBtn = document.querySelector('button[aria-label*="New session"], button[aria-label*="New Chat"], [data-testid="new-chat-button"]');
          if (newSessionBtn) {
            newSessionBtn.click();
          } else {
            window.location.hash = "";
            window.location.reload();
          }
        } else {
          // Trigger view refresh to drop removed session
          window.location.reload();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setDeleting(false);
      }
    };

    return jsx(Modal, {
      open: true,
      onClose: close,
      title: "Delete session",
      description: `Permanently delete "${prompt.displayTitle}"? This will erase all message history and session data from disk. This action cannot be undone.`,
      footer: jsxs(Fragment, {
        children: [
          jsx(Button, {
            variant: "outline",
            disabled: deleting,
            onClick: close,
            children: "Cancel",
          }),
          jsx(Button, {
            variant: "outline",
            danger: true,
            disabled: deleting,
            onClick: confirm,
            children: deleting ? "Deleting..." : "Delete permanently",
          }),
        ],
      }),
      children: error
        ? jsx("div", {
            style: { color: "var(--dsw-danger, #ef4444)", marginTop: 12, fontSize: 13 },
            children: error,
          })
        : null,
    });
  }

  function apply(ctx) {
    if (!ctx.slots) return;

    // 1. Inject Menu item into Session context menu
    ctx.slots.inject("sidebar.workspaces.session.menu.item", function* () {
      yield ctx.slots.register(
        {
          name: "sidebar.workspaces.session.menu.item",
          id: "delete-session",
          order: 500,
        },
        DeleteSessionMenuItem
      );
    });

    // 2. Inject Modal Overlay into Shell overlays
    ctx.slots.inject("shell.overlay", function* () {
      yield ctx.slots.register(
        {
          name: "shell.overlay",
          id: "workspace.session-delete-overlay",
        },
        DeleteSessionModalOverlay
      );
    });
  }

  exports.name = "dsh-plugin-session-delete";
  exports.apply = apply;
  exports.DeleteSessionMenuItem = DeleteSessionMenuItem;
  exports.DeleteSessionModalOverlay = DeleteSessionModalOverlay;
  exports.setPrompt = setPrompt;
  return exports;
}

if (typeof window !== "undefined" && window.__ModuleLoader__) {
  window.__ModuleLoader__.load({
    id: "dsh-plugin-session-delete",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      definePlugin(require, exports, module);
      return module.exports;
    },
  });
}

if (typeof module !== "undefined" && module.exports) {
  definePlugin(require, module.exports, module);
}
