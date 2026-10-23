import { MODULE_ID } from "./menu-data.js";

const MACRO_FOLDER_NAME = "Table Launcher Macros";

/** Find (or create) the dedicated folder every macro this module generates gets filed
 * into, so they don't clutter the top level of the macro directory. */
async function getOrCreateMacroFolder() {
  const existing = game.folders.find(f => f.type === "Macro" && f.name === MACRO_FOLDER_NAME);
  if (existing) return existing;
  return Folder.create({ name: MACRO_FOLDER_NAME, type: "Macro", parent: null });
}

/** Create (or reuse) a world macro for the given menu in a specific mode - "popup" opens
 * the editing/view popup, "chat" posts the menu's content straight to chat. A menu can
 * have both, tracked as separate macros distinguished by their own macroMode flag. */
export async function createMenuMacro(menu, mode) {
  const command =
    mode === "chat"
      ? `game.modules.get("${MODULE_ID}").api.postJournalMenu("${menu.id}");`
      : `game.modules.get("${MODULE_ID}").api.openMenu("${menu.id}");`;

  const name = mode === "chat" ? `${menu.name} (Chat)` : `${menu.name} (Popup)`;
  const folder = await getOrCreateMacroFolder();

  const existing = game.macros.find(
    m => m.getFlag(MODULE_ID, "menuId") === menu.id && m.getFlag(MODULE_ID, "macroMode") === mode
  );
  if (existing) {
    const update = { name, command };
    if (existing.folder?.id !== folder.id) update.folder = folder.id;
    await existing.update(update);
    ui.notifications.info(`BTM: updated existing macro "${name}".`);
    return existing;
  }

  const macro = await Macro.create({
    name,
    type: "script",
    scope: "global",
    command,
    img: mode === "chat" ? "icons/svg/message.svg" : "icons/svg/book.svg",
    folder: folder.id,
    flags: {
      [MODULE_ID]: { menuId: menu.id, macroMode: mode }
    }
  });
  ui.notifications.info(`BTM: created macro "${name}".`);
  return macro;
}
