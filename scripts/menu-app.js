import {
  MODULE_ID,
  getMenu,
  updateMenu,
  deleteMenu,
  addEntry,
  updateEntry,
  deleteEntry,
  addTableToCompound,
  removeTableFromCompound,
  reorderEntry,
  reorderSubTable
} from "./menu-data.js";
import { executeEntry } from "./roller.js";
import { createMenuMacro } from "./macro-generator.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MenuApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(menuId, options = {}) {
    super(options);
    this.menuId = menuId;
    this.editMode = false;
    this.#dragDrop = this.#createDragDropHandlers();
  }

  static DEFAULT_OPTIONS = {
    id: "btm-menu-{id}",
    classes: ["bobbins-table-menu", "btm-menu-app"],
    tag: "div",
    window: {
      title: "Bobbins Table Menu",
      icon: "fa-solid fa-dice-d20",
      resizable: true,
      controls: [
        {
          icon: "fa-solid fa-gear",
          label: "BTM.EditMode",
          action: "toggleEdit",
          visible: () => game.user.isGM
        },
        {
          icon: "fa-solid fa-file-export",
          label: "BTM.CreateMenuMacro",
          action: "createMacro",
          visible: () => game.user.isGM
        },
        {
          icon: "fa-solid fa-trash",
          label: "BTM.DeleteMenu",
          action: "deleteMenu",
          visible: () => game.user.isGM
        }
      ]
    },
    position: { width: 360, height: "auto" },
    actions: {
      toggleEdit: MenuApp.#onToggleEdit,
      roll: MenuApp.#onRoll,
      deleteEntry: MenuApp.#onDeleteEntry,
      deleteMenu: MenuApp.#onDeleteMenu,
      createMacro: MenuApp.#onCreateMacro,
      addCompound: MenuApp.#onAddCompound,
      addText: MenuApp.#onAddText,
      addHeader: MenuApp.#onAddHeader,
      removeSubTable: MenuApp.#onRemoveSubTable,
      toggleOutputMode: MenuApp.#onToggleOutputMode
    },
    dragDrop: [{ dragSelector: ".btm-draggable-entry, .btm-draggable-sub", dropSelector: ".btm-drop-zone" }]
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/menu-app.hbs` }
  };

  #dragDrop;

  get title() {
    const menu = getMenu(this.menuId);
    return menu?.name ?? "Bobbins Table Menu";
  }

  async _prepareContext(_options) {
    const menu = getMenu(this.menuId);
    return {
      menu,
      editMode: this.editMode,
      isGM: game.user.isGM
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.#dragDrop.forEach(d => d.bind(this.element));
    this.#activateEditListeners();
  }

  async close(options) {
    await this.#savePosition();
    return super.close(options);
  }

  async #savePosition() {
    const { left, top, width, height } = this.position;
    await updateMenu(this.menuId, { windowPosition: { left, top, width, height } });
  }

  #activateEditListeners() {
    this.element.querySelectorAll(".btm-menu-name-input").forEach(el => {
      el.addEventListener("change", ev => this.#renameMenu(ev.currentTarget.value));
    });
    this.element.querySelectorAll("[data-rename-field]").forEach(el => {
      el.addEventListener("change", ev => {
        const entryId = ev.currentTarget.closest("[data-entry-id]")?.dataset.entryId;
        const field = ev.currentTarget.dataset.renameField;
        this.#renameEntry(entryId, field, ev.currentTarget.value);
      });
    });
  }

  async #renameMenu(value) {
    const trimmed = value?.trim();
    if (trimmed) await updateMenu(this.menuId, { name: trimmed });
    this.render();
  }

  async #renameEntry(entryId, field, value) {
    if (!entryId || !field) return;
    await updateEntry(this.menuId, entryId, { [field]: value });
    this.render();
  }

  #createDragDropHandlers() {
    return (this.options.dragDrop ?? []).map(cfg => {
      cfg.permissions = {
        dragstart: () => this.editMode,
        drop: () => this.editMode && game.user.isGM
      };
      cfg.callbacks = {
        dragstart: this._onDragStart.bind(this),
        drop: this._onDrop.bind(this)
      };
      return new foundry.applications.ux.DragDrop.implementation(cfg);
    });
  }

  _onDragStart(event) {
    const subEl = event.target?.closest?.(".btm-draggable-sub");
    const entryEl = event.target?.closest?.(".btm-draggable-entry");

    let payload;
    if (subEl) {
      const compoundEl = subEl.closest("[data-compound-drop]");
      payload = {
        type: "btm-reorder-sub",
        entryId: compoundEl?.dataset.entryId,
        subId: subEl.dataset.subId
      };
    } else if (entryEl) {
      payload = { type: "btm-reorder-entry", entryId: entryEl.dataset.entryId };
    } else {
      return;
    }
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
    event.dataTransfer.effectAllowed = "move";
  }

  async _onDrop(event) {
    if (!this.editMode) return;
    const data = MenuApp.#getDragData(event);
    if (!data) return;

    const compoundTarget = event.target?.closest?.("[data-compound-drop]");
    const compoundEntryId = compoundTarget?.dataset?.entryId;

    if (data.type === "btm-reorder-entry") {
      const targetEntryId = event.target?.closest?.("[data-entry-id]")?.dataset.entryId;
      await reorderEntry(this.menuId, data.entryId, targetEntryId === data.entryId ? null : targetEntryId);
      this.render();
      return;
    }

    if (data.type === "btm-reorder-sub") {
      const targetSubId = event.target?.closest?.("[data-sub-id]")?.dataset.subId;
      await reorderSubTable(
        this.menuId,
        data.entryId,
        data.subId,
        targetSubId === data.subId ? null : targetSubId
      );
      this.render();
      return;
    }

    if (data.type === "RollTable") {
      const table = await fromUuid(data.uuid);
      if (!table) return;

      if (compoundEntryId) {
        await addTableToCompound(this.menuId, compoundEntryId, table.id, table.name);
      } else {
        await addEntry(this.menuId, {
          type: "table",
          tableId: table.id,
          label: table.name,
          outputMode: null
        });
      }
      this.render();
      return;
    }

    if (data.type === "Macro" && !compoundEntryId) {
      const macro = await fromUuid(data.uuid);
      if (!macro) return;
      await addEntry(this.menuId, {
        type: "macro",
        macroId: macro.id,
        label: macro.name
      });
      this.render();
    }
  }

  static #getDragData(event) {
    try {
      const raw = event.dataTransfer?.getData("text/plain");
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ---- Actions ----

  static async #onToggleEdit(_event, _target) {
    this.editMode = !this.editMode;
    this.render();
  }

  static async #onRoll(_event, target) {
    if (this.editMode) return; // clicks in edit mode shouldn't roll
    const menu = getMenu(this.menuId);
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    const entry = menu?.entries.find(e => e.id === entryId);
    if (!entry) return;
    await executeEntry(menu, entry);
  }

  static async #onDeleteEntry(_event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BTM.DeleteEntry") },
      content: `<p>${game.i18n.localize("BTM.ConfirmDeleteEntry")}</p>`
    });
    if (!confirmed) return;
    await deleteEntry(this.menuId, entryId);
    this.render();
  }

  static async #onRemoveSubTable(_event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    const subTableId = target.closest("[data-sub-id]")?.dataset.subId;
    await removeTableFromCompound(this.menuId, entryId, subTableId);
    this.render();
  }

  static async #onDeleteMenu(_event, _target) {
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize("BTM.DeleteMenu") },
      content: `<p>${game.i18n.localize("BTM.ConfirmDeleteMenu")}</p>`
    });
    if (!confirmed) return;
    await deleteMenu(this.menuId);
    this.close();
  }

  static async #onCreateMacro(_event, _target) {
    const menu = getMenu(this.menuId);
    if (menu) await createMenuMacro(menu);
  }

  static async #onAddCompound(_event, _target) {
    await addEntry(this.menuId, {
      type: "compound",
      label: game.i18n.localize("BTM.NewCompound"),
      template: "",
      tables: []
    });
    this.render();
  }

  static async #onAddText(_event, _target) {
    await addEntry(this.menuId, { type: "text", content: "" });
    this.render();
  }

  static async #onAddHeader(_event, _target) {
    await addEntry(this.menuId, { type: "header", label: game.i18n.localize("BTM.NewHeader") });
    this.render();
  }

  static async #onToggleOutputMode(_event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    if (entryId) {
      const menu = getMenu(this.menuId);
      const entry = menu.entries.find(e => e.id === entryId);
      const current = entry.outputMode || menu.outputMode || "chat";
      const next = current === "chat" ? "popup" : "chat";
      await updateEntry(this.menuId, entryId, { outputMode: next });
    } else {
      const menu = getMenu(this.menuId);
      const next = menu.outputMode === "chat" ? "popup" : "chat";
      await updateMenu(this.menuId, { outputMode: next });
    }
    this.render();
  }

}
