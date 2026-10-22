import { iconHtml, escapeHtml } from "./chip-render.js";

const { ApplicationV2 } = foundry.applications.api;

/**
 * choice-popup.js
 * -----------------------------------------------------------------------
 * Public API surface: game.modules.get("bobbins-table-menu").api.showChoicePopup().
 * A read-only prompt - no editing, no drag-drop, none of MenuApp's machinery
 * - for another module (Bobbins Tables' Decision nodes, primarily) to ask
 * "pick one of these" using the same icon+label chip look as a real menu.
 *
 * Deliberately its own tiny ApplicationV2, not a stripped-down MenuApp -
 * MenuApp is for editing/owning a persistent menu; this is a one-shot
 * prompt a caller awaits the answer from. Each call opens its own window,
 * and picking a choice closes it.
 */
class ChoicePopupApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "btm-choice-popup",
    classes: ["bobbins-table-menu", "btm-menu", "btm-choice-popup"],
    tag: "div",
    window: { title: "Bobbins Table Menu", icon: "fa-solid fa-dice-d20", resizable: true, minimizable: false },
    position: { width: 320, height: "auto" }
  };

  constructor(options = {}) {
    super(options);
    this._resolve = options.resolve;
    this._title = options.title;
    this._choiceOptions = options.choiceOptions;
  }

  get title() { return this._title || "Choose"; }

  async _renderHTML() {
    const items = this._choiceOptions.map(opt => {
      const icon = iconHtml(opt.uuid ?? `Choice.${opt.id}`, opt.icon ?? null, true);
      return `<li class="btm-entry">
        <button type="button" class="btm-roll-btn" data-choice-id="${escapeHtml(opt.id)}">
          ${icon}<span>${escapeHtml(opt.label)}</span>
        </button>
      </li>`;
    }).join("");
    return `<div class="btm-menu"><ol class="btm-entry-list">${items}</ol></div>`;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelectorAll("[data-choice-id]").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.choiceId;
        this._settled = true;
        this._resolve(id);
        this.close();
      });
    });
  }

  /** If closed without a choice (the "x" button, escape), resolve with null rather than hanging the caller forever. */
  async close(options) {
    if (!this._settled) { this._settled = true; this._resolve(null); }
    return super.close(options);
  }
}

/**
 * @param {object} params
 * @param {string} params.title - the question
 * @param {{id:string, label:string, icon?:string, uuid?:string}[]} params.options
 * @returns {Promise<string|null>} the chosen option's id, or null if dismissed
 */
export async function showChoicePopup({ title, options }) {
  if (!options?.length) return null;

  return new Promise(resolve => {
    new ChoicePopupApp({ title, choiceOptions: options, resolve }).render(true);
  });
}
