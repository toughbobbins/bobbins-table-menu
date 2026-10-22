import { getMenu } from "./menu-data.js";
import { MenuApp } from "./menu-app.js";
import { JournalMenuApp } from "./journal-menu-app.js";
import { showChoicePopup } from "./choice-popup.js";

export { showChoicePopup };

const openApps = new Map();

// MenuApp/JournalMenuApp instances call Hooks.callAll("close<ClassName>", app, ...) on close
// (core AppV2 behavior). Listen once, filter by menuId, so we clean up the right map entry
// regardless of which menu popup closed.
Hooks.on("closeMenuApp", app => cleanup(app));
Hooks.on("closeJournalMenuApp", app => cleanup(app));

function cleanup(app) {
  if (app?.menuId && openApps.get(app.menuId) === app) {
    openApps.delete(app.menuId);
  }
}

/** Open (or focus, if already open) the popup for a given menu id. */
export function openMenu(menuId, { startInEditMode = false } = {}) {
  if (!game.user.isGM) {
    ui.notifications.warn(game.i18n.localize("BTM.GmOnly"));
    return null;
  }
  const menu = getMenu(menuId);
  if (!menu) {
    ui.notifications.warn("Bobbins Table Menu: that menu no longer exists.");
    return null;
  }

  if (openApps.has(menuId)) {
    const existing = openApps.get(menuId);
    existing.render(true);
    existing.bringToFront();
    return existing;
  }

  // "list" kind is kept only for backward compatibility with menus created before
  // this module consolidated to a single journal-style editor for every new menu.
  const AppClass = menu.kind === "list" ? MenuApp : JournalMenuApp;
  const appOptions = { id: `btm-menu-${menuId}` };
  if (menu.windowPosition) appOptions.position = { ...menu.windowPosition };
  if (startInEditMode) appOptions.startInEditMode = true;
  const app = new AppClass(menuId, appOptions);
  openApps.set(menuId, app);
  app.render(true);
  return app;
}
