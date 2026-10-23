import { getMenu } from "./menu-data.js";
import { JournalMenuApp } from "./journal-menu-app.js";
import { showChoicePopup } from "./choice-popup.js";

export { showChoicePopup };

const openApps = new Map();

// JournalMenuApp instances call Hooks.callAll("closeJournalMenuApp", app, ...) on close
// (core AppV2 behavior). Listen once, filter by menuId, so we clean up the right map entry.
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
    ui.notifications.warn("BTM: that menu no longer exists.");
    return null;
  }

  if (openApps.has(menuId)) {
    const existing = openApps.get(menuId);
    existing.render(true);
    existing.bringToFront();
    return existing;
  }

  // Menus made with the older list-style editor (since removed) can't be opened any more.
  if (menu.kind === "list") {
    ui.notifications.warn("BTM: that menu no longer exists.");
    return null;
  }
  const appOptions = { id: `btm-menu-${menuId}` };
  if (menu.windowPosition) appOptions.position = { ...menu.windowPosition };
  if (startInEditMode) appOptions.startInEditMode = true;
  const app = new JournalMenuApp(menuId, appOptions);
  openApps.set(menuId, app);
  app.render(true);
  return app;
}
