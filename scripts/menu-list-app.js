import { MODULE_ID, getMenus, createMenu, deleteMenu } from "./menu-data.js";
import { openMenu } from "./api.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MenuListApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "btm-menu-list",
    classes: ["bobbins-table-menu", "btm-menu-list-app"],
    window: {
      title: "BTM.ModuleTitle",
      icon: "fa-solid fa-dice-d20"
    },
    position: { width: 300, height: "auto" },
    actions: {
      openMenu: MenuListApp.#onOpenMenu,
      newMenu: MenuListApp.#onNewMenu,
      deleteMenu: MenuListApp.#onDeleteMenu
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/menu-list.hbs` }
  };

  async _prepareContext(_options) {
    return { menus: getMenus(), isGM: game.user.isGM };
  }

  static async #onOpenMenu(_event, target) {
    const menuId = target.closest("[data-menu-id]")?.dataset.menuId;
    if (menuId) openMenu(menuId);
  }

  static async #onNewMenu(_event, _target) {
    const menu = await createMenu();
    this.render();
    openMenu(menu.id, { startInEditMode: true });
  }

  static async #onDeleteMenu(event, target) {
    event.stopPropagation();
    const row = target.closest("[data-menu-id]");
    const menuId = row?.dataset.menuId;
    if (!menuId) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BTM.DeleteMenu") },
      content: `<p>${game.i18n.localize("BTM.ConfirmDeleteMenu")}</p>`
    });
    if (!confirmed) return;

    await deleteMenu(menuId);
    this.render();
  }
}
