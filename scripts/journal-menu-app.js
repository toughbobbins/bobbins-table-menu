import { MODULE_ID, getMenu, updateMenu, deleteMenu, setChipIcon, setChipStyle, setChipScale, setChipBorder, setMenuTheme } from "./menu-data.js";
import { createMenuMacro } from "./macro-generator.js";
import { postJournalMenuToChat } from "./journal-chat.js";
import { interceptRollTableLinks, applyChipStyling, resolveChipIconSrc } from "./content-link-intercept.js";
import { buildChipInnerHtml, iconHtml, escapeHtml } from "./chip-render.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Foundry's enrichHTML helper moved namespace across versions - resolve whichever is present. */
function getTextEditor() {
  return foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

const FALLBACK_FONT_CHOICES = [
  { value: "", label: "Default font" },
  { value: "Arial", label: "Arial" },
  { value: "Georgia", label: "Georgia (serif)" },
  { value: "Times New Roman", label: "Times New Roman" },
  { value: "Courier New", label: "Courier New (mono)" },
  { value: "Verdana", label: "Verdana" }
];

/** Foundry maintains its own roster of every font available to it (system-bundled plus
 * any the world has registered) in CONFIG.fontDefinitions - pull the real list from
 * there so every font Foundry itself can use is selectable here too, rather than a
 * short hardcoded handful. Falls back to a small fixed list if that API isn't present
 * in this core version, so the toolbar never ends up with an empty font menu. */
function getFontChoices() {
  try {
    const defs = CONFIG.fontDefinitions;
    const names = defs && typeof defs === "object" ? Object.keys(defs).sort((a, b) => a.localeCompare(b)) : [];
    if (names.length) {
      return [{ value: "", label: "Default font" }, ...names.map(name => ({ value: name, label: name }))];
    }
  } catch (err) {
    console.warn("Bobbins Table Menu: couldn't read CONFIG.fontDefinitions, using a fallback font list", err);
  }
  return FALLBACK_FONT_CHOICES;
}

/** Real pixel sizes, not the old S/M/L/XL scale - lets text be set to an exact size
 * rather than one of four coarse presets. A selected chip is also resized when one of
 * these is picked, scaled proportionally against a 16px baseline (its normal size). */
const SIZE_CHOICES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 64, 72, 96].map(px => ({
  value: String(px),
  label: String(px)
}));
const CHIP_SCALE_BASELINE_PX = 16;

const TABLEGRID_MAX_ROWS = 4;
const TABLEGRID_MAX_COLS = 4;

/**
 * Journal-style menu: a plain contenteditable box with a small custom formatting
 * toolbar, not Foundry's ProseMirror editor. Foundry's built-in rich-text editor kept
 * rendering its toolbar broken/garbled inside this popup for reasons that couldn't be
 * pinned down, and it turned out to always build its own toolbar regardless of the
 * plugin config passed to it - so basic formatting (bold/italic/underline/font/size) is
 * implemented here directly with the browser's own execCommand, avoiding Foundry's
 * editor entirely. Dropping a RollTable/Macro inserts Foundry's own `@UUID[...]`
 * content-link syntax as text, which `TextEditor.enrichHTML()` (a separate, simpler,
 * working API) turns into a real clickable link both for display and when posted to chat.
 */
export class JournalMenuApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #savedRange = null;
  #selectionChangeHandler = null;
  #draggedChip = null;
  #selectedChips = [];
  #selectedImage = null;
  #savePromise = null;

  constructor(menuId, options = {}) {
    super(options);
    this.menuId = menuId;
    this.editMode = !!options.startInEditMode;
  }

  static DEFAULT_OPTIONS = {
    id: "btm-journal-menu-{id}",
    classes: ["bobbins-table-menu", "btm-journal-menu-app"],
    tag: "div",
    window: {
      title: "Bobbins Table Menu",
      icon: "fa-solid fa-book-open",
      resizable: true,
      controls: [
        {
          icon: "fa-solid fa-circle-half-stroke",
          label: "BTM.ToggleTheme",
          action: "toggleTheme",
          visible: () => game.user.isGM
        },
        {
          icon: "fa-solid fa-share-from-square",
          label: "BTM.PostToChat",
          action: "postToChat"
        },
        {
          icon: "fa-solid fa-window-restore",
          label: "BTM.CreateMacroPopup",
          action: "createMacroPopup",
          visible: () => game.user.isGM
        },
        {
          icon: "fa-solid fa-comment",
          label: "BTM.CreateMacroChat",
          action: "createMacroChat",
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
    position: { width: 420, height: 480 },
    actions: {
      toggleTheme: JournalMenuApp.#onToggleTheme,
      postToChat: JournalMenuApp.#onPostToChat,
      createMacroPopup: JournalMenuApp.#onCreateMacroPopup,
      createMacroChat: JournalMenuApp.#onCreateMacroChat,
      deleteMenu: JournalMenuApp.#onDeleteMenu,
      format: JournalMenuApp.#onFormat,
      openTableGrid: JournalMenuApp.#onOpenTableGrid
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/journal-menu-app.hbs` }
  };

  get title() {
    return getMenu(this.menuId)?.name ?? "Bobbins Table Menu";
  }

  async _prepareContext(_options) {
    const menu = getMenu(this.menuId);
    const TE = getTextEditor();
    const enriched = await TE.enrichHTML(menu?.content ?? "", { async: true });
    return {
      menu,
      editMode: this.editMode,
      enriched,
      fonts: getFontChoices(),
      sizes: SIZE_CHOICES,
      isGM: game.user.isGM,
      isDark: menu?.theme === "dark"
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    this.element.classList.toggle("btm-theme-dark", context.isDark);
    this.#activateNameListener();
    this.#injectHeaderControls();
    this.#activateMenuNavDrop();
    if (this.editMode) {
      this.#activatePlainEditor();
    } else {
      const display = this.element.querySelector(".btm-journal-display");
      if (display) {
        const menu = getMenu(this.menuId);
        applyChipStyling(display, menu).then(() => interceptRollTableLinks(display, menu?.gmRoll ?? false));
      }
    }
  }

  async close(options) {
    this.#deactivateSelectionTracking();
    closeFloatingPopups();
    await this.#saveEditorContent();
    await this.#savePosition();
    return super.close(options);
  }

  #deactivateSelectionTracking() {
    if (this.#selectionChangeHandler) {
      document.removeEventListener("selectionchange", this.#selectionChangeHandler);
      this.#selectionChangeHandler = null;
    }
  }

  #activateNameListener() {
    this.element.querySelectorAll(".btm-menu-name-input").forEach(el => {
      el.addEventListener("change", async ev => {
        const value = ev.currentTarget.value?.trim();
        if (value) await updateMenu(this.menuId, { name: value });
      });
    });
  }

  /** Insert GM Roll / theme / edit-live toggle buttons directly into the window's own
   * title bar, to the left of the "..." controls toggle - requested so they sit at the
   * very top of the popup instead of inside the scrollable content area. The title bar
   * frame is only built once by ApplicationV2 (not rebuilt on every render() the way the
   * body content is), so this checks for each button's existence and updates its state
   * in place on subsequent renders, rather than re-creating it. */
  #injectHeaderControls() {
    if (!game.user.isGM) return;
    const header = this.element.querySelector(".window-header");
    if (!header) return;
    const controlsBtn = header.querySelector('[data-action="toggleControls"]');
    if (!controlsBtn) return;

    const menu = getMenu(this.menuId);

    let gmRollBtn = header.querySelector(".btm-header-gmroll");
    if (!gmRollBtn) {
      gmRollBtn = document.createElement("button");
      gmRollBtn.type = "button";
      gmRollBtn.className = "header-control icon fa-solid fa-bullhorn btm-header-gmroll";
      gmRollBtn.addEventListener("click", async () => {
        const current = getMenu(this.menuId);
        if (this.editMode) await this.#saveEditorContent();
        await updateMenu(this.menuId, { gmRoll: !current?.gmRoll });
        this.render();
      });
      header.insertBefore(gmRollBtn, controlsBtn);
    }
    // GM Roll is the intended default/expected state, so the highlight instead flags
    // the less common one: lit up (red) when rolls from this menu are PUBLIC.
    gmRollBtn.classList.toggle("btm-header-active", !menu?.gmRoll);
    gmRollBtn.dataset.tooltip = menu?.gmRoll ? "GM Roll: on (whispered to GMs)" : "Public roll (click for GM Roll)";

    let editBtn = header.querySelector(".btm-header-edit-toggle");
    if (!editBtn) {
      editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "header-control icon fa-solid btm-header-edit-toggle";
      editBtn.addEventListener("click", async () => {
        if (this.editMode) {
          this.#deactivateSelectionTracking();
          // Give any just-triggered blur (e.g. from an editable chip label, or the
          // browser finishing a pending DOM mutation from the last keystroke) a moment
          // to fully apply before reading the DOM to save - clicking this button can
          // otherwise race with that and occasionally miss the latest edit.
          await new Promise(resolve => requestAnimationFrame(resolve));
          await this.#saveEditorContent();
          this.editMode = false;
        } else {
          this.editMode = true;
        }
        this.render();
      });
      header.insertBefore(editBtn, controlsBtn);
    }
    editBtn.classList.toggle("fa-eye", this.editMode);
    editBtn.classList.toggle("fa-pen", !this.editMode);
    editBtn.dataset.tooltip = this.editMode ? "Switch to live" : "Switch to edit";
  }

  /** Drop one of this module's own menu-opening macros anywhere on this window (outside
   * the live text editor, which handles its own drops) to jump straight to that other
   * menu - a quick way to navigate between related menus without going through the
   * menu list each time. Only recognizes macros this module itself generated (via
   * "Build Macro for Popup/Chat") - identified by their own menuId/macroMode flags. */
  #activateMenuNavDrop() {
    const root = this.element;
    const isOutsideEditor = ev => !ev.target.closest?.(".btm-journal-editor-target");

    root.addEventListener("dragover", ev => {
      if (isOutsideEditor(ev)) {
        ev.preventDefault();
        root.classList.add("btm-nav-drop-hover");
      }
    });

    root.addEventListener("dragleave", ev => {
      if (isOutsideEditor(ev)) root.classList.remove("btm-nav-drop-hover");
    });

    root.addEventListener("drop", async ev => {
      root.classList.remove("btm-nav-drop-hover");
      if (!isOutsideEditor(ev)) return;
      let data;
      try {
        data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      if (data.type !== "Macro") return;

      const macro = await fromUuid(data.uuid);
      const targetMenuId = macro?.getFlag(MODULE_ID, "menuId");
      if (!targetMenuId) return; // not one of this module's own menu-opening macros

      ev.preventDefault();
      const targetMode = macro.getFlag(MODULE_ID, "macroMode");
      const api = game.modules.get(MODULE_ID).api;
      if (targetMode === "chat") {
        await api.postJournalMenu(targetMenuId);
      } else {
        api.openMenu(targetMenuId);
      }
    });
  }

  async #activatePlainEditor() {
    const menu = getMenu(this.menuId);
    const target = this.element.querySelector(".btm-journal-editor-target");
    if (!target) return;

    this.#deactivateSelectionTracking();

    target.contentEditable = "true";
    target.innerHTML = await markupToChips(menu?.content ?? "", menu?.chipIcons ?? {}, menu?.chipStyle ?? {}, menu?.chipScale ?? {}, menu?.chipBorder ?? {});
    this.#wrapInsertedTables(target);
    this.#ensureEditableAnchor(target);
    target.addEventListener("dragover", ev => {
      if (ev.target.closest?.(".btm-table-select-all-btn")) return; // not a drop zone
      ev.preventDefault();
    });
    target.addEventListener("dragstart", ev => this.#onChipDragStart(ev));
    target.addEventListener("drop", ev => this.#onEditorDrop(ev, target));
    target.addEventListener("contextmenu", ev => this.#onChipContextMenu(ev));

    // Clear any lingering native browser Selection on mousedown, before a potential drag
    // begins - a Selection left active on a chip (user-select:none) from a previous
    // click-to-select can confuse the browser's own drag-initiation logic, which is
    // what was blocking dragging on a chip that was already selected. #selectChips()
    // below re-establishes the selection normally if this mousedown turns into a click
    // rather than a drag.
    target.addEventListener("mousedown", ev => {
      if (ev.target.closest?.(".btm-editor-chip")) {
        window.getSelection()?.removeAllRanges();
      }
    });

    // Click a chip to select it as a whole unit (rather than just placing a cursor
    // beside it) - this is what makes alignment/formatting apply to the chip's
    // containing line reliably, and is what lets Delete/Backspace remove the chip in
    // one press rather than fighting the browser's inconsistent handling of an atomic
    // non-editable node's edges. Click the select-all button in an inserted table's
    // corner to select every chip in that table at once, for bulk edits.
    target.addEventListener("click", ev => {
      const selectAllBtn = ev.target.closest?.(".btm-table-select-all-btn");
      if (selectAllBtn) {
        const wrapper = selectAllBtn.closest(".btm-table-wrapper");
        const chips = wrapper ? [...wrapper.querySelectorAll(".btm-editor-chip")] : [];
        this.#selectChips(chips);
        return;
      }
      const image = ev.target.closest?.(".btm-inserted-image");
      if (image) {
        this.#selectImage(image);
        return;
      }
      this.#deselectImage();
      const chip = ev.target.closest?.(".btm-editor-chip");
      if (chip && !ev.target.closest(".btm-chip-label")) {
        this.#selectChips([chip]);
      } else {
        this.#deselectChips();
      }
    });

    target.addEventListener("keydown", ev => {
      if ((ev.key === "Delete" || ev.key === "Backspace") && this.#selectedImage) {
        ev.preventDefault();
        this.#removeImage(this.#selectedImage, target);
        return;
      }
      if ((ev.key === "Delete" || ev.key === "Backspace") && this.#selectedChips.length) {
        ev.preventDefault();
        this.#selectedChips.forEach(c => c.remove());
        this.#selectedChips = [];
        this.#ensureEditableAnchor(target);
        this.#saveEditorContent();
      }
    });

    // Capture phase - "blur" doesn't bubble, so this is the only way to catch it for a
    // nested editable chip label (the "icon + label" style's label is independently
    // contenteditable even though the chip itself isn't).
    target.addEventListener(
      "blur",
      ev => {
        const label = ev.target.closest?.(".btm-chip-label");
        if (label) {
          const chip = label.closest(".btm-editor-chip");
          if (chip) chip.dataset.name = label.textContent.trim() || chip.dataset.uuid;
        }
        this.#saveEditorContent();
      },
      true
    );

    // Keep track of the last selection made inside the editor, continuously (not just
    // on mouseup/keyup - selectionchange catches every case, including selections a
    // toolbar click might otherwise collapse before a narrower listener could fire).
    // Needed because toolbar controls (especially a <select>, which can't use the
    // mousedown-preventDefault trick without blocking its dropdown from opening) can
    // steal focus and collapse the live selection before their own handler runs.
    this.#selectionChangeHandler = () => {
      const sel = window.getSelection();
      if (sel.rangeCount && target.contains(sel.anchorNode) && target.contains(sel.focusNode)) {
        this.#savedRange = sel.getRangeAt(0).cloneRange();
      }
    };
    document.addEventListener("selectionchange", this.#selectionChangeHandler);

    // Prevent toolbar buttons from stealing focus away from the editor on mousedown -
    // by the time a click event fires, the browser may have already collapsed the text
    // selection, so execCommand would apply to nothing. Keeping focus (and the
    // selection) in the editor is what lets formatting apply to the selected text.
    this.element.querySelectorAll(".btm-format-btn").forEach(el => {
      el.addEventListener("mousedown", ev => ev.preventDefault());
    });

    this.element.querySelectorAll(".btm-format-font-select").forEach(select => {
      select.addEventListener("change", async () => {
        if (!select.value) return;
        this.#restoreSelection(target);
        document.execCommand("fontName", false, select.value);
        const newSpans = convertLegacyFontTags(target);
        const range = reselectNodes(newSpans);
        if (range) this.#savedRange = range.cloneRange();
        await this.#saveEditorContent();
      });
    });

    this.element.querySelectorAll(".btm-format-fontsize-select").forEach(select => {
      select.addEventListener("change", async () => {
        const px = Number(select.value);
        if (!px) return;
        select.value = ""; // reset to the "Size" placeholder after each use

        if (this.#selectedChips.length) {
          await this.#applyChipScale(this.#selectedChips, px / CHIP_SCALE_BASELINE_PX);
          return;
        }

        this.#restoreSelection(target);
        // execCommand's fontSize only understands the legacy 1-7 scale, so it's used
        // purely as a mechanism to wrap the selection in a <font> element at all - the
        // size itself is then set for real via convertPxFontTags below, independent of
        // that coarse scale.
        document.execCommand("fontSize", false, "7");
        const newSpans = convertPxFontTags(target, px);
        const range = reselectNodes(newSpans);
        if (range) this.#savedRange = range.cloneRange();
        await this.#saveEditorContent();
      });
    });
  }

  /** Refocus the editor and reapply the last selection made inside it (see saveRange
   * above), since focus/selection may have been lost interacting with a toolbar control
   * that can't use the mousedown-preventDefault trick (e.g. a <select>). Falls back to
   * placing the cursor at the end of the content if the saved range is no longer valid -
   * this happens more often right at the edges of a non-editable chip, where the
   * browser's own selection handling is inherently less consistent. */
  #restoreSelection(target) {
    target.focus();
    const sel = window.getSelection();

    const rangeStillValid =
      this.#savedRange &&
      target.contains(this.#savedRange.startContainer) &&
      target.contains(this.#savedRange.endContainer);

    if (rangeStillValid) {
      sel.removeAllRanges();
      sel.addRange(this.#savedRange);
      return;
    }

    const fallback = document.createRange();
    fallback.selectNodeContents(target);
    fallback.collapse(false);
    sel.removeAllRanges();
    sel.addRange(fallback);
  }

  /** Select one or more chips as whole nodes (not just placing the cursor beside one),
   * using Range.selectNode for a single chip - this is what makes alignment/format
   * commands correctly find the chip's containing block (its parent becomes the
   * range's start/end container), and makes Delete/Backspace remove it as a single unit
   * like any other selected content. Multiple chips (e.g. via a table's "select all"
   * button) just get the visual/logical selection - there's no single Range that can
   * represent several disjoint nodes at once, so alignment doesn't apply in that case,
   * but Delete and the S/M/L/XL/style/icon bulk actions all still work across all of them. */
  #selectChips(chips) {
    this.#deselectChips();
    this.#selectedChips = chips;
    chips.forEach(c => c.classList.add("btm-chip-selected"));
    if (chips.length === 1) {
      const range = document.createRange();
      range.selectNode(chips[0]);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      this.#savedRange = range.cloneRange();
    }
  }

  #deselectChips() {
    this.#selectedChips.forEach(c => c.classList.remove("btm-chip-selected"));
    this.#selectedChips = [];
  }

  /** Select an inserted image (blue outline, like a selected chip) so Delete/Backspace
   * can remove it. Images are plain <img> elements rather than chips, so they need
   * their own selection state - without this, a placed image could never be selected
   * or removed at all. */
  #selectImage(img) {
    this.#deselectImage();
    this.#deselectChips();
    img.classList.add("btm-image-selected");
    this.#selectedImage = img;
  }

  #deselectImage() {
    this.#selectedImage?.classList.remove("btm-image-selected");
    this.#selectedImage = null;
  }

  async #removeImage(img, target) {
    if (this.#selectedImage === img) this.#selectedImage = null;
    img.remove();
    this.#ensureEditableAnchor(target);
    await this.#saveEditorContent();
  }

  /** Make sure the editable body always ends with a real (non-atomic) anchor - a text
   * node or a <br> - not just chips. Browsers can fail to establish ANY typing cursor
   * at all when a contenteditable region's entire content is made of atomic
   * contenteditable=false islands (like our chips) with zero real text anywhere -
   * clicking around them silently fails to place a caret, so typing does nothing. A
   * table cell always contains a real placeholder (see #insertTable), which is why
   * cells kept working while an all-chip body outside any table didn't. */
  #ensureEditableAnchor(target) {
    const lastChild = target.lastChild;
    const lastChildIsRealAnchor =
      lastChild &&
      ((lastChild.nodeType === Node.TEXT_NODE && lastChild.textContent.length > 0) ||
        (lastChild.nodeType === Node.ELEMENT_NODE && lastChild.tagName === "BR"));
    if (!lastChildIsRealAnchor) {
      target.appendChild(document.createElement("br"));
    }
  }

  /** Wrap every inserted table not already wrapped in a `.btm-table-wrapper` containing
   * a hover-revealed "select all chips in this table" button - a table itself can't
   * directly contain a <button> (invalid HTML table content model), so this wraps it in
   * a plain div instead. Only relevant in edit mode; unwrapped again before saving (see
   * chipsToMarkup) so the button never ends up in stored content or the final output. */
  #wrapInsertedTables(root) {
    root.querySelectorAll(".btm-inserted-table").forEach(table => {
      if (table.parentElement?.classList.contains("btm-table-wrapper")) return;
      const wrapper = document.createElement("div");
      wrapper.className = "btm-table-wrapper";
      table.replaceWith(wrapper);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btm-table-select-all-btn";
      btn.contentEditable = "false";
      btn.title = "Select all chips in this table";
      btn.innerHTML = '<i class="fa-solid fa-object-group"></i>';
      wrapper.appendChild(btn);
      wrapper.appendChild(table);
    });
  }

  /** Mark the drag as "moving one of our own chips" (with a reference to the exact
   * node) rather than a brand new drop from a sidebar directory, so #onEditorDrop can
   * tell the two apart. */
  #onChipDragStart(event) {
    const chip = event.target.closest?.(".btm-editor-chip");
    if (!chip) return;
    this.#draggedChip = chip;
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "btm-chip-move" }));
    event.dataTransfer.effectAllowed = "move";
  }

  /** Insert a dropped RollTable/Macro (or reposition an existing chip being dragged
   * within the editor) at the actual mouse-drop position rather than wherever the text
   * cursor last happened to be - important once content can contain a multi-cell table,
   * where "last cursor position" and "where you just dropped something" are often two
   * different cells entirely. */
  async #onEditorDrop(event, target) {
    event.preventDefault();
    if (event.target.closest?.(".btm-table-select-all-btn")) {
      this.#draggedChip = null; // don't leave a stale reference for the next drag
      return;
    }

    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch {
      return;
    }

    if (data.type === "btm-chip-move") {
      const chip = this.#draggedChip;
      this.#draggedChip = null;
      if (!chip || !target.contains(chip)) return;

      const dropRange = getRangeFromPoint(event.clientX, event.clientY);
      if (dropRange && target.contains(dropRange.startContainer)) {
        insertNodeAtRange(dropRange, chip);
      }
      await this.#saveEditorContent();
      return;
    }

    if (data.type !== "RollTable" && data.type !== "Macro") return;

    const doc = await fromUuid(data.uuid);
    if (!doc) return;

    const menu = getMenu(this.menuId);
    const imgSrc = await resolveChipIconSrc(data.uuid, menu?.chipIcons?.[data.uuid]);
    const style = menu?.chipStyle?.[data.uuid] || "compact";
    const scale = menu?.chipScale?.[data.uuid] || "1";
    const border = !!menu?.chipBorder?.[data.uuid];
    const chip = createChipElement(data.uuid, doc.name, imgSrc, style, scale, border);

    const dropRange = getRangeFromPoint(event.clientX, event.clientY);
    if (dropRange && target.contains(dropRange.startContainer)) {
      insertNodeAtRange(dropRange, chip);
    } else {
      insertNodeAtCursor(target, chip);
    }
    await this.#saveEditorContent();
  }

  /** Right-click a chip to rename its display label, switch it between the generic
   * icon and the linked table/macro's own icon, or change its layout style. If the
   * chip is part of a multi-selection (e.g. via a table's "select all" button), the
   * icon/style choice applies to every selected chip at once - only the label stays
   * single-target, since bulk-renaming different chips to the same text rarely makes
   * sense. */
  async #onChipContextMenu(event) {
    const image = event.target.closest?.(".btm-inserted-image");
    if (image) {
      this.#onImageContextMenu(event, image);
      return;
    }
    const chip = event.target.closest?.(".btm-editor-chip");
    if (!chip) {
      if (!event.target.closest?.(".btm-table-select-all-btn")) this.#onEditorContextMenu(event);
      return;
    }
    event.preventDefault();

    closeFloatingPopups();
    const targets = this.#selectedChips.length > 1 && this.#selectedChips.includes(chip) ? this.#selectedChips : [chip];
    const menu = getMenu(this.menuId);
    const iconSetting = menu?.chipIcons?.[chip.dataset.uuid];
    const iconMode = typeof iconSetting === "string" ? "custom" : iconSetting === true ? "table" : "default";
    const usingBorder = !!menu?.chipBorder?.[chip.dataset.uuid];
    const currentStyle = chip.dataset.style || "compact";
    const multiSuffix = targets.length > 1 ? ` (${targets.length} chips)` : "";

    const popup = document.createElement("div");
    popup.className = "btm-chip-context-menu";
    popup.innerHTML = `
      <button type="button" data-action="edit-label"><i class="fa-solid fa-pen"></i> Edit Label</button>
      <div class="btm-chip-menu-divider"></div>
      <button type="button" data-action="icon-default" ${iconMode === "default" ? "disabled" : ""}>
        <i class="fa-solid fa-dice-d20"></i> Use Default Icon${multiSuffix}
      </button>
      <button type="button" data-action="icon-table" ${iconMode === "table" ? "disabled" : ""}>
        <i class="fa-solid fa-image"></i> Use Table's Icon${multiSuffix}
      </button>
      <button type="button" data-action="icon-custom" ${iconMode === "custom" ? "disabled" : ""}>
        <i class="fa-solid fa-file-image"></i> Choose Icon Image...${multiSuffix}
      </button>
      <button type="button" data-action="toggle-border"><i class="fa-solid fa-square"></i> ${
        usingBorder ? "Remove Border" : "Add Border"
      }${multiSuffix}</button>
      <div class="btm-chip-menu-divider"></div>
      <button type="button" data-action="style-compact" ${currentStyle === "compact" ? "disabled" : ""}>
        <i class="fa-solid fa-tag"></i> Compact${multiSuffix}
      </button>
      <button type="button" data-action="style-icon" ${currentStyle === "icon" ? "disabled" : ""}>
        <i class="fa-solid fa-square"></i> Icon${multiSuffix}
      </button>
      <button type="button" data-action="style-icon-label" ${currentStyle === "icon-label" ? "disabled" : ""}>
        <i class="fa-solid fa-image"></i> Icon + Label${multiSuffix}
      </button>
    `;
    positionFloatingPopup(popup, event.clientX, event.clientY);
    document.body.appendChild(popup);
    bindPopupDismiss(popup);

    popup.querySelector('[data-action="edit-label"]').addEventListener("click", async () => {
      popup.remove();
      const newLabel = window.prompt("Chip label:", chip.dataset.name);
      if (newLabel === null) return;
      const trimmed = newLabel.trim();
      if (!trimmed) return;
      await this.#rebuildChip(chip, { name: trimmed });
      await this.#saveEditorContent();
    });

    popup.querySelector('[data-action="icon-default"]').addEventListener("click", async () => {
      popup.remove();
      for (const t of targets) {
        await setChipIcon(this.menuId, t.dataset.uuid, false);
        await this.#rebuildChip(t, {});
      }
      await this.#saveEditorContent();
    });

    popup.querySelector('[data-action="icon-table"]').addEventListener("click", async () => {
      popup.remove();
      for (const t of targets) {
        await setChipIcon(this.menuId, t.dataset.uuid, true);
        await this.#rebuildChip(t, {});
      }
      await this.#saveEditorContent();
    });

    popup.querySelector('[data-action="icon-custom"]').addEventListener("click", () => {
      popup.remove();
      new FilePicker({
        type: "image",
        callback: async path => {
          for (const t of targets) {
            await setChipIcon(this.menuId, t.dataset.uuid, path);
            await this.#rebuildChip(t, {});
          }
          await this.#saveEditorContent();
        }
      }).render(true);
    });

    popup.querySelector('[data-action="toggle-border"]').addEventListener("click", async () => {
      popup.remove();
      for (const t of targets) {
        const currentlyBordered = !!getMenu(this.menuId)?.chipBorder?.[t.dataset.uuid];
        await setChipBorder(this.menuId, t.dataset.uuid, !currentlyBordered);
        await this.#rebuildChip(t, { border: !currentlyBordered });
      }
      await this.#saveEditorContent();
    });

    for (const style of ["compact", "icon", "icon-label"]) {
      popup.querySelector(`[data-action="style-${style}"]`)?.addEventListener("click", async () => {
        popup.remove();
        for (const t of targets) {
          await setChipStyle(this.menuId, t.dataset.uuid, style);
          await this.#rebuildChip(t, { style });
        }
        await this.#saveEditorContent();
      });
    }
  }

  /** Rebuild a chip's inner content/attributes in place (label, icon source, and/or
   * layout style), re-reading whichever pieces weren't explicitly overridden from the
   * chip's own current state or the menu's stored per-uuid preferences. */
  async #rebuildChip(chip, { name, style, border } = {}) {
    const uuid = chip.dataset.uuid;
    const finalName = name ?? chip.dataset.name;
    const finalStyle = style ?? chip.dataset.style ?? "compact";
    const wasSelected = chip.classList.contains("btm-chip-selected");
    const menu = getMenu(this.menuId);
    const finalBorder = border ?? !!menu?.chipBorder?.[uuid];
    const imgSrc = await resolveChipIconSrc(uuid, menu?.chipIcons?.[uuid]);

    chip.dataset.name = finalName;
    chip.dataset.style = finalStyle;
    chip.className = `btm-editor-chip btm-chip-style-${finalStyle}${wasSelected ? " btm-chip-selected" : ""}`;
    chip.title = finalName;
    chip.dataset.tooltip = finalName;

    // className reassignment above doesn't touch the style attribute - reset then
    // reapply the inline overrides so they match the (possibly just-changed) style/
    // border/scale state.
    chip.removeAttribute("style");
    if (finalBorder) {
      chip.style.setProperty("border-color", "currentColor", "important");
      chip.style.setProperty("border-radius", "5px", "important");
      chip.style.setProperty(
        "box-shadow",
        "inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.3), 0 1px 1px rgba(0,0,0,0.15)",
        "important"
      );
    }
    const scale = menu?.chipScale?.[uuid] || "1";
    if (scale !== "1") chip.style.setProperty("--btm-chip-scale", scale);
    if (finalStyle !== "compact") {
      chip.style.setProperty("display", "inline-flex", "important");
      chip.style.setProperty("flex-direction", "column", "important");
      chip.style.setProperty("overflow", "visible", "important");
      chip.style.setProperty("text-overflow", "clip", "important");
      chip.style.setProperty("max-width", "none", "important");
      chip.style.setProperty("min-width", "0", "important");
    }

    const escapedLabel = escapeHtml(finalName);
    chip.innerHTML = buildChipInnerHtml(uuid, escapedLabel, imgSrc, finalStyle, true);
  }

  /** Right-click an inserted image to remove it. */
  #onImageContextMenu(event, image) {
    event.preventDefault();
    closeFloatingPopups();
    this.#selectImage(image);

    const popup = document.createElement("div");
    popup.className = "btm-chip-context-menu";
    popup.innerHTML = `
      <button type="button" data-action="remove-image"><i class="fa-solid fa-trash"></i> Remove Image</button>
    `;
    positionFloatingPopup(popup, event.clientX, event.clientY);
    document.body.appendChild(popup);
    bindPopupDismiss(popup);

    popup.querySelector('[data-action="remove-image"]').addEventListener("click", () => {
      popup.remove();
      const target = this.element.querySelector(".btm-journal-editor-target");
      if (target) this.#removeImage(image, target);
    });
  }

  /** Right-click on blank editor space (not a chip) offers general insertion options -
   * currently just choosing an image to drop straight into the text at that position. */
  #onEditorContextMenu(event) {
    event.preventDefault();
    closeFloatingPopups();

    const dropRange = getRangeFromPoint(event.clientX, event.clientY);

    const popup = document.createElement("div");
    popup.className = "btm-chip-context-menu";
    popup.innerHTML = `
      <button type="button" data-action="insert-image"><i class="fa-solid fa-image"></i> Choose Image...</button>
    `;
    positionFloatingPopup(popup, event.clientX, event.clientY);
    document.body.appendChild(popup);
    bindPopupDismiss(popup);

    popup.querySelector('[data-action="insert-image"]').addEventListener("click", () => {
      popup.remove();
      this.#openImagePicker(dropRange);
    });
  }

  /** Open Foundry's own file browser to pick an image, then insert it directly into the
   * editor at wherever was right-clicked (or the current cursor, if that position is no
   * longer valid by the time an image is chosen). */
  #openImagePicker(range) {
    const target = this.element.querySelector(".btm-journal-editor-target");
    if (!target) return;

    new FilePicker({
      type: "image",
      callback: async path => {
        const img = document.createElement("img");
        img.src = path;
        img.className = "btm-inserted-image";

        if (range && target.contains(range.startContainer)) {
          insertNodeAtRange(range, img);
        } else {
          insertNodeAtCursor(target, img);
        }
        this.#ensureEditableAnchor(target);
        await this.#saveEditorContent();
      }
    }).render(true);
  }

  static async #onOpenTableGrid(event, target) {
    closeFloatingPopups();
    const app = this;

    const popup = document.createElement("div");
    popup.className = "btm-tablegrid-picker";

    const grid = document.createElement("div");
    grid.className = "btm-tablegrid-cells";
    grid.style.gridTemplateColumns = `repeat(${TABLEGRID_MAX_COLS}, 1fr)`;

    const label = document.createElement("div");
    label.className = "btm-tablegrid-label";
    label.textContent = "Insert table";

    const cells = [];
    for (let r = 1; r <= TABLEGRID_MAX_ROWS; r++) {
      for (let c = 1; c <= TABLEGRID_MAX_COLS; c++) {
        const cell = document.createElement("div");
        cell.className = "btm-tablegrid-cell";
        cell.dataset.row = r;
        cell.dataset.col = c;
        cell.addEventListener("mouseenter", () => {
          cells.forEach(other => {
            other.classList.toggle("active", Number(other.dataset.row) <= r && Number(other.dataset.col) <= c);
          });
          label.textContent = `${r} x ${c}`;
        });
        cell.addEventListener("click", async () => {
          popup.remove();
          await app.#insertTable(r, c);
        });
        cells.push(cell);
        grid.appendChild(cell);
      }
    }

    popup.appendChild(grid);
    popup.appendChild(label);
    positionFloatingPopupBelow(popup, target);
    document.body.appendChild(popup);
    bindPopupDismiss(popup);
  }

  async #insertTable(rows, cols) {
    const target = this.element.querySelector(".btm-journal-editor-target");
    if (!target) return;
    this.#restoreSelection(target);

    const table = document.createElement("table");
    table.className = "btm-inserted-table";
    const tbody = document.createElement("tbody");
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c++) {
        const td = document.createElement("td");
        td.innerHTML = "<br>";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);

    insertNodeAtCursor(target, table);
    this.#wrapInsertedTables(target);
    await this.#saveEditorContent();
  }

  /** Serialized so two near-simultaneous calls (e.g. a blur-triggered save from an
   * editable chip label, immediately followed by the edit->live toggle's own save)
   * can't race each other. updateMenu() does a read-modify-write against the whole
   * menus array - if a second call started before the first's write had actually
   * landed, it would read a stale array and silently overwrite the first save's
   * content when it wrote back. Waiting for any in-flight save before starting a new
   * one (and always reading the DOM fresh at call time, never a stale snapshot) closes
   * that gap. */
  async #saveEditorContent() {
    const target = this.element?.querySelector(".btm-journal-editor-target");
    if (!target || target.contentEditable !== "true") return;
    if (this.#savePromise) await this.#savePromise;

    this.#savePromise = (async () => {
      let content;
      try {
        content = chipsToMarkup(target);
      } catch (err) {
        console.error("Bobbins Table Menu: failed to serialize editor content for saving", err);
        ui.notifications.error("Bobbins Table Menu: failed to save - see console (F12) for details.");
        throw err;
      }
      try {
        await updateMenu(this.menuId, { content });
      } catch (err) {
        console.error("Bobbins Table Menu: failed to write saved content", err);
        ui.notifications.error("Bobbins Table Menu: failed to save - see console (F12) for details.");
        throw err;
      }
    })();

    try {
      await this.#savePromise;
    } catch {
      // Already logged/notified above - swallow here so callers (e.g. the edit/live
      // toggle) can still finish switching modes instead of getting stuck.
    } finally {
      this.#savePromise = null;
    }
  }

  async #savePosition() {
    const { left, top, width, height } = this.position;
    await updateMenu(this.menuId, { windowPosition: { left, top, width, height } });
  }

  static async #onPostToChat(_event, _target) {
    if (this.editMode) await this.#saveEditorContent();
    const menu = getMenu(this.menuId);
    await postJournalMenuToChat(menu);
  }

  static async #onCreateMacroPopup(_event, _target) {
    const menu = getMenu(this.menuId);
    if (menu) await createMenuMacro(menu, "popup");
  }

  static async #onCreateMacroChat(_event, _target) {
    const menu = getMenu(this.menuId);
    if (menu) await createMenuMacro(menu, "chat");
  }

  static async #onToggleTheme(_event, _target) {
    const current = getMenu(this.menuId);
    if (this.editMode) await this.#saveEditorContent();
    await setMenuTheme(this.menuId, current?.theme === "dark" ? "light" : "dark");
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

  /** Apply a basic formatting command (bold/italic/underline/etc.) to the current
   * selection within the editor, using the browser's own execCommand - deprecated but
   * still universally supported, and enough for basic formatting without needing
   * Foundry's problematic rich-text editor. Justify commands are handled separately
   * (see #applyAlignment) since execCommand's justify* commands are unreliable once a
   * non-editable chip is anywhere near the selection. */
  static async #onFormat(_event, target) {
    const editor = this.element.querySelector(".btm-journal-editor-target");
    if (!editor) return;

    const command = target.dataset.command;

    this.#restoreSelection(editor);

    const alignMap = { justifyLeft: "left", justifyCenter: "center", justifyRight: "right" };
    if (alignMap[command]) {
      applyAlignment(editor, alignMap[command]);
    } else {
      document.execCommand(command, false, target.dataset.value || undefined);
      const newSpans = convertLegacyFontTags(editor);
      const range = reselectNodes(newSpans);
      if (range) this.#savedRange = range.cloneRange();
    }
    await this.#saveEditorContent();
  }

  /** Scale one or more chips' own size, matching the same font-size dropdown that
   * resizes text - a non-editable chip can't be wrapped by execCommand's fontSize the
   * way text can, so this sets a CSS custom property the chip's own rules scale against
   * instead. `scale` is a plain multiplier (e.g. 1.5), not a legacy size keyword. */
  async #applyChipScale(chips, scale) {
    const scaleStr = String(Math.round(scale * 100) / 100);
    for (const chip of chips) {
      await setChipScale(this.menuId, chip.dataset.uuid, scaleStr);
      if (scaleStr === "1") chip.style.removeProperty("--btm-chip-scale");
      else chip.style.setProperty("--btm-chip-scale", scaleStr);
    }
    await this.#saveEditorContent();
  }
}

/** Foundry's justify* execCommand support is unreliable once a non-editable chip is
 * anywhere near the selection - browsers generally only apply text-align correctly to
 * actual text nodes, and a chip isn't one. Alignment is inherently block-level anyway
 * (it aligns the whole line/paragraph, not the exact selected characters), so this sets
 * text-align directly on every line (block) the selection touches instead of routing
 * through execCommand at all. Text typed before the first Enter sits directly inside
 * the editor with no wrapping block, so those lines are wrapped in a <div> first -
 * otherwise there's nothing to align except the whole editor. */
function applyAlignment(root, alignValue) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let range = sel.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;

  range = wrapBareLines(root, range) ?? range;

  // A block holding its own line of text AND a nested block (e.g. <div>line2<div>line3
  // </div></div>, which Chrome produces in some editing sequences) would otherwise lose
  // line2: only the innermost block is aligned, so the outer block's own text is skipped.
  // Splitting each such block's loose text into its own line fixes that.
  const mixed = [...root.querySelectorAll(ALIGNABLE_BLOCK_SELECTOR)].filter(
    el =>
      !el.classList.contains("btm-table-wrapper") &&
      range.intersectsNode(el) &&
      [...el.children].some(child => child.matches(ALIGNABLE_BLOCK_SELECTOR))
  );
  for (const block of mixed) range = wrapBareLines(root, range, block) ?? range;

  let blocks = blocksInRange(root, range);
  if (!blocks.length) blocks = [root];
  blocks.forEach(block => {
    block.style.textAlign = alignValue;
  });
}

const ALIGNABLE_BLOCK_SELECTOR = "p, div, li, td, th, blockquote, h1, h2, h3, h4, h5, h6";

/** Every alignable block the range touches, innermost only (a table cell and the div
 * inside it both match - only the div is returned), skipping the edit-mode table
 * wrapper and any block the range merely ends at the very start of (a triple-click
 * selection ends at the start of the NEXT line, which isn't part of the selection). */
function blocksInRange(root, range) {
  const hit = [...root.querySelectorAll(ALIGNABLE_BLOCK_SELECTOR)].filter(
    el => !el.classList.contains("btm-table-wrapper") && range.intersectsNode(el) && !endsAtBlockStart(range, el)
  );
  return hit.filter(el => !hit.some(other => other !== el && el.contains(other)));
}

function endsAtBlockStart(range, block) {
  if (range.collapsed || range.endOffset !== 0 || !block.contains(range.endContainer)) return false;
  let node = range.endContainer;
  while (node !== block) {
    if (node.parentNode.firstChild !== node) return false;
    node = node.parentNode;
  }
  return true;
}

/** Wrap each line of bare content sitting directly inside `root` (not inside any block)
 * that the range touches in its own <div>, so it can be aligned on its own. Lines
 * separated by <br> get a div each. Returns a fresh Range matching the original
 * selection if anything was wrapped (moving a node collapses any selection boundary
 * inside it, so the selection is rebuilt afterwards), or null if nothing needed it. */
function wrapBareLines(root, range, container = root) {
  const isBlock = node => node.nodeType === Node.ELEMENT_NODE && node.matches(ALIGNABLE_BLOCK_SELECTOR);

  const segments = [];
  let current = [];
  const close = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (const child of [...container.childNodes]) {
    if (isBlock(child)) {
      close();
      continue;
    }
    current.push(child);
    if (child.nodeName === "BR") close();
  }
  close();

  const toWrap = segments.filter(seg => {
    const hasContent = seg.some(n => (n.nodeType === Node.TEXT_NODE ? n.textContent.trim() : true));
    const isLoneTrailingBr = seg.length === 1 && seg[0].nodeName === "BR" && seg[0] === container.lastChild;
    return hasContent && !isLoneTrailingBr && seg.some(n => range.intersectsNode(n));
  });
  if (!toWrap.length) return null;

  // Record the selection's boundaries in a form that survives the nodes being moved.
  // A boundary directly on `root` is described relative to a neighbouring child instead
  // of an offset, since wrapping changes root's child indexes.
  const ref = (c, offset) => {
    if (c !== container) return { container: c, offset };
    const child = container.childNodes[offset];
    return child ? { node: child, before: true } : { node: container.lastChild, before: false };
  };
  const start = ref(range.startContainer, range.startOffset);
  const end = ref(range.endContainer, range.endOffset);

  for (const seg of toWrap) {
    const div = document.createElement("div");
    container.insertBefore(div, seg[0]);
    seg.forEach(n => div.appendChild(n));
  }

  const rebuilt = document.createRange();
  rebuilt.setStart(root, 0);
  rebuilt.setEnd(root, 0);
  const place = (r, isStart) => {
    if (r.node === undefined) return isStart ? rebuilt.setStart(r.container, r.offset) : rebuilt.setEnd(r.container, r.offset);
    if (!r.node) return isStart ? rebuilt.setStart(container, 0) : rebuilt.setEnd(container, 0);
    if (isStart) return r.before ? rebuilt.setStartBefore(r.node) : rebuilt.setStartAfter(r.node);
    return r.before ? rebuilt.setEndBefore(r.node) : rebuilt.setEndAfter(r.node);
  };
  place(start, true);
  place(end, false);

  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(rebuilt);
  return rebuilt;
}

/** Same idea as convertLegacyFontTags, but for an exact pixel value from the font-size
 * dropdown rather than the coarse legacy 1-7 scale - execCommand("fontSize", false, "7")
 * is only ever used as a mechanism to get the selection wrapped in a <font> element at
 * all, then the real requested size is applied here directly, independent of that scale. */
function convertPxFontTags(root, px) {
  const newSpans = [];
  root.querySelectorAll("font").forEach(font => {
    const span = document.createElement("span");
    span.style.fontSize = `${px}px`;
    span.innerHTML = font.innerHTML;
    font.replaceWith(span);
    newSpans.push(span);
  });
  return newSpans;
}

/** execCommand's fontName/fontSize insert deprecated <font> tags whose presentational
 * attributes lose to any CSS rule with real specificity - convert them to inline-styled
 * spans instead, which always win regardless of what else styles the editor content.
 * Returns the new spans, since replacing a node destroys any selection referencing it -
 * callers use this to restore the highlight afterward. */
function convertLegacyFontTags(root) {
  const sizeMap = { 1: "10px", 2: "13px", 3: "16px", 4: "18px", 5: "24px", 6: "32px", 7: "48px" };
  const newSpans = [];
  root.querySelectorAll("font").forEach(font => {
    const span = document.createElement("span");
    if (font.face) span.style.fontFamily = font.face;
    if (font.size) span.style.fontSize = sizeMap[font.size] || "16px";
    span.innerHTML = font.innerHTML;
    font.replaceWith(span);
    newSpans.push(span);
  });
  return newSpans;
}

/** Reselect a set of nodes (e.g. spans just created by convertLegacyFontTags) so the
 * formatted text stays visibly highlighted after the change, instead of the selection
 * silently collapsing. */
function reselectNodes(nodes) {
  if (!nodes.length) return;
  const range = document.createRange();
  range.setStartBefore(nodes[0]);
  range.setEndAfter(nodes[nodes.length - 1]);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  return range;
}

/** Turn `@UUID[...]{name}` markers into non-editable preview "chips" that look like the
 * final clickable link, so editing/formatting text around them can't accidentally break
 * the link syntax, and so it's obvious how each link will actually appear once posted.
 * Async because a chip flagged to show its table/macro's own icon needs to look that up. */
async function markupToChips(html, chipIcons = {}, chipStyles = {}, chipScales = {}, chipBorders = {}) {
  const matches = [...html.matchAll(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g)];
  if (!matches.length) return html;

  const iconCache = new Map();
  for (const match of matches) {
    const uuid = match[1];
    if (chipIcons[uuid] && !iconCache.has(uuid)) {
      iconCache.set(uuid, await resolveChipIconSrc(uuid, chipIcons[uuid]));
    }
  }

  return html.replace(/@UUID\[([^\]]+)\](?:\{([^}]*)\})?/g, (_match, uuid, name) => {
    const label = name || uuid;
    // `label` was extracted from already-serialized HTML, so it's already HTML-safe -
    // escaping it again here would double-escape entities like &amp;.
    const attrSafeLabel = label.replace(/"/g, "&quot;");
    const style = chipStyles[uuid] || "compact";
    const scale = chipScales[uuid] || "1";
    const border = !!chipBorders[uuid];
    return buildChipOuterHtml(uuid, attrSafeLabel, iconCache.get(uuid), style, scale, border);
  });
}

/** The reverse of markupToChips - convert preview chips back into `@UUID[...]{name}`
 * text markers before saving, since that's the format enrichHTML() understands. */
function chipsToMarkup(container) {
  const clone = container.cloneNode(true);
  clone.querySelectorAll(".btm-image-selected").forEach(el => el.classList.remove("btm-image-selected"));
  clone.querySelectorAll(".btm-table-wrapper").forEach(wrapper => {
    const table = wrapper.querySelector(".btm-inserted-table");
    if (table) wrapper.replaceWith(table);
    else wrapper.remove();
  });
  clone.querySelectorAll(".btm-editor-chip").forEach(chip => {
    chip.replaceWith(document.createTextNode(`@UUID[${chip.dataset.uuid}]{${chip.dataset.name}}`));
  });
  return clone.innerHTML;
}

/** Build the full chip element's outer HTML (wrapper + inner content) for a given
 * layout style, for the edit-mode preview specifically (label editable in "icon-label"
 * style). `escapedLabel` must already be HTML-safe. Layout for icon/icon-label styles
 * is forced via inline !important - a plain external stylesheet rule (even !important)
 * wasn't reliably beating Foundry's own chat-log-specific content-link CSS; an inline
 * !important declaration beats any external stylesheet rule regardless of specificity. */
function buildChipOuterHtml(uuid, escapedLabel, imgSrc, style, scale = "1", border = false) {
  const inner = buildChipInnerHtml(uuid, escapedLabel, imgSrc, style, true);
  // Always show the real table/macro name on hover (not just for "icon" style, and not
  // Foundry's own generic document-type tooltip) - both title and data-tooltip get set
  // since either could be what actually renders the hover text.
  const titleAttr = ` title="${escapedLabel}" data-tooltip="${escapedLabel}"`;

  const styleParts = [];
  if (scale && scale !== "1") styleParts.push(`--btm-chip-scale: ${scale}`);
  if (border) {
    styleParts.push(
      "border-color: currentColor !important",
      "border-radius: 5px !important",
      "box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.3), 0 1px 1px rgba(0,0,0,0.15) !important"
    );
  }
  if (style !== "compact") {
    styleParts.push(
      "display: inline-flex !important",
      "flex-direction: column !important",
      "overflow: visible !important",
      "text-overflow: clip !important",
      "max-width: none !important",
      "min-width: 0 !important"
    );
  }
  const styleAttr = styleParts.length ? ` style="${styleParts.join("; ")};"` : "";

  return `<span class="btm-editor-chip btm-chip-style-${style}" contenteditable="false" draggable="true" data-uuid="${uuid}" data-name="${escapedLabel}" data-style="${style}"${titleAttr}${styleAttr}>${inner}</span>`;
}

function createChipElement(uuid, name, imgSrc, style = "compact", scale = "1", border = false) {
  const wrapper = document.createElement("div");
  wrapper.innerHTML = buildChipOuterHtml(uuid, escapeHtml(name), imgSrc, style, scale, border);
  return wrapper.firstElementChild;
}

/** Insert a DOM node at the current cursor position within a contenteditable element. */
function insertNodeAtCursor(el, node) {
  el.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  insertNodeAtRange(sel.getRangeAt(0), node);
}

/** Insert a DOM node at a specific Range (e.g. the exact mouse-drop position). */
function insertNodeAtRange(range, node) {
  range.deleteContents();
  range.insertNode(node);
  range.setStartAfter(node);
  range.setEndAfter(node);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Resolve a text Range from viewport coordinates (e.g. a drop event's clientX/clientY),
 * using whichever of the two browser APIs for this is available. */
function getRangeFromPoint(x, y) {
  if (document.caretRangeFromPoint) {
    return document.caretRangeFromPoint(x, y);
  }
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (!pos) return null;
    const range = document.createRange();
    range.setStart(pos.offsetNode, pos.offset);
    range.collapse(true);
    return range;
  }
  return null;
}

function closeFloatingPopups() {
  document.querySelectorAll(".btm-chip-context-menu, .btm-tablegrid-picker").forEach(el => el.remove());
}

function positionFloatingPopup(popup, x, y) {
  popup.style.left = `${x}px`;
  popup.style.top = `${y}px`;
}

function positionFloatingPopupBelow(popup, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = `${rect.bottom + 4}px`;
}

/** Dismiss a floating popup on the next click anywhere, or on Escape. Deferred by a
 * tick so the click that opened the popup doesn't immediately close it again. */
function bindPopupDismiss(popup) {
  const dismiss = () => {
    popup.remove();
    document.removeEventListener("click", dismiss, true);
    document.removeEventListener("keydown", onKeydown, true);
  };
  const onKeydown = ev => {
    if (ev.key === "Escape") dismiss();
  };
  setTimeout(() => {
    document.addEventListener("click", dismiss, true);
    document.addEventListener("keydown", onKeydown, true);
  }, 0);
}
