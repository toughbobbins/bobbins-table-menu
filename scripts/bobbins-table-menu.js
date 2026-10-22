import { MODULE_ID, registerSettings, getMenu } from "./menu-data.js";
import { MenuListApp } from "./menu-list-app.js";
import { openMenu, showChoicePopup } from "./api.js";
import { postJournalMenuToChat } from "./journal-chat.js";
import { interceptRollTableLinks, applyChipStyling } from "./content-link-intercept.js";

Hooks.once("init", () => {
  registerSettings();
  foundry.applications.handlebars.loadTemplates([
    `modules/${MODULE_ID}/templates/menu-app.hbs`,
    `modules/${MODULE_ID}/templates/menu-list.hbs`,
    `modules/${MODULE_ID}/templates/journal-menu-app.hbs`
  ]);
});

Hooks.once("ready", () => {
  const module = game.modules.get(MODULE_ID);
  module.api = {
    openMenu,
    openMenuList: () => {
      if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("BTM.GmOnly"));
      return new MenuListApp().render(true);
    },
    // Not GM-gated on purpose: another module (Bobbins Tables decision nodes) calls this
    // while rolling, and it only ever shows a pick-one prompt.
    showChoicePopup,
    postJournalMenu: menuId => {
      if (!game.user.isGM) return ui.notifications.warn(game.i18n.localize("BTM.GmOnly"));
      const menu = getMenu(menuId);
      if (!menu) {
        ui.notifications.warn("Bobbins Table Menu: that menu no longer exists.");
        return;
      }
      return postJournalMenuToChat(menu);
    }
  };
});

// Add a button to the RollTable directory sidebar to open the menu list.
Hooks.on("renderRollTableDirectory", (app, html) => {
  if (!game.user.isGM) return; // GM-only module: players don't get the button
  const root = html instanceof HTMLElement ? html : html[0];
  const header = root.querySelector(".directory-header .action-buttons, .directory-header");
  if (!header || header.querySelector(".btm-open-list-btn")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("btm-open-list-btn");
  button.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${game.i18n.localize("BTM.OpenMenuList")}`;
  button.addEventListener("click", () => new MenuListApp().render(true));
  header.appendChild(button);
});

Hooks.on("renderChatMessageHTML", (message, html) => {
  if (!message.getFlag?.(MODULE_ID, "journalCard")) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;
  const menu = getMenu(message.getFlag(MODULE_ID, "menuId"));
  applyChipStyling(root, menu).then(() => interceptRollTableLinks(root, menu?.gmRoll ?? false));
});

// Legacy jQuery-based hook for v12, which doesn't have renderChatMessageHTML. Only
// registered on cores older than v13: on v13 Foundry logs a deprecation warning for
// every listener on the old hook name (and removes it in v15), and the element-based
// hook above already covers v13.
Hooks.once("init", () => {
  if ((game.release?.generation ?? 13) >= 13) return;
  Hooks.on("renderChatMessage", (message, html) => {
    if (!message.getFlag?.(MODULE_ID, "journalCard")) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    const menu = getMenu(message.getFlag(MODULE_ID, "menuId"));
    applyChipStyling(root, menu).then(() => interceptRollTableLinks(root, menu?.gmRoll ?? false));
  });
});
