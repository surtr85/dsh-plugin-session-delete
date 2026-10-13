/**
 * DeepSeek Harness Web Client Plugin
 * Injects "Delete session" into the session row context menu (sidebar.workspaces.session.menu.item).
 */

function definePlugin(require, exports, module) {
  const React = require("react");
  let primitives = null;
  try {
    primitives = require("@deepseek-ai/dsh-client-ui-primitives");
  } catch {}

  function apply(ctx) {
    if (!ctx.slots) return;

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
              `Permanently delete "${title}"?\n\nThis will erase all messages and session data from disk. This cannot be undone.`
            );
            if (!confirmed) return;

            try {
              const res = await fetch("/api/session/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId }),
              });
              const data = await res.json();
              if (!data.ok) {
                alert(data.error || "Failed to delete session");
                return;
              }

              const isCurrent = window.location.href.includes(sessionId);
              if (isCurrent) {
                const newChatBtn = document.querySelector(
                  'button[aria-label*="New session"], button[aria-label*="New Chat"], [data-testid="new-chat-button"]'
                );
                if (newChatBtn) {
                  newChatBtn.click();
                } else {
                  window.location.hash = "";
                  window.location.reload();
                }
              } else {
                window.location.reload();
              }
            } catch (err) {
              alert("Failed to delete session: " + err.message);
            }
          };

          const icon = primitives?.IconTrashOutlineRegular
            ? React.createElement(primitives.IconTrashOutlineRegular, { size: 14 })
            : "🗑 ";

          if (primitives?.MenuItemButton) {
            return React.createElement(
              primitives.MenuItemButton,
              {
                danger: true,
                separatorBefore: true,
                icon,
                onSelect: handleDelete,
              },
              "Delete session"
            );
          }

          return React.createElement(
            "button",
            {
              type: "button",
              role: "menuitem",
              style: {
                display: "flex",
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "8px 12px",
                color: "#ef4444",
                border: "none",
                background: "transparent",
                cursor: "pointer",
                textAlign: "left",
              },
              onClick: handleDelete,
            },
            icon,
            "Delete session"
          );
        }
      );
    });
  }

  exports.name = "dsh-plugin-session-delete";
  exports.inject = ["slots"];
  exports.apply = apply;
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
