export const MODULE_ID = "bobbins-table-menu";
export const SETTING_MENUS = "menus";

/**
 * Menu shape:
 * {
 *   id: string,
 *   name: string,
 *   kind: "journal",   // every menu is a rich-text page; the older "list" kind is no longer supported
 *   gmRoll: boolean,   // when true, rolls triggered from this menu are whispered to GMs only
 *   chipIcons: { [uuid]: true | "path/to/image.png" },   // true = table/macro's own icon, string = custom chosen image
 *   chipStyle: { [uuid]: "compact" | "icon" | "icon-label" },   // per-table chip layout, default "compact"
 *   chipScale: { [uuid]: "0.7" | "1" | "1.4" | "2" },   // per-table chip size (S/M/L/XL), default "1"
 *   chipBorder: { [uuid]: true },   // tables/macros the user chose to show a thin text-colored border around
 *   theme: "light" | "dark",   // per-menu color theme, default "light"
 *   windowPosition: { left, top, width, height } | undefined,
 *   content: string   // rich HTML with embedded content links
 * }
 */

export const SETTING_DELEGATED_FORMATTING = "delegatedResultFormatting";

export function registerSettings() {
  game.settings.register(MODULE_ID, SETTING_MENUS, {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

  // Governs how results from a table another module actively manages (via the
  // delegateToOwningModule() convention in roller.js) get displayed here. That
  // module's own rollTable() may return richly formatted HTML (bold labels, its own
  // line breaks, etc.) - this setting decides whether to keep that formatting as-is, or
  // strip it down to plain text so every result looks the same regardless of source,
  // which is this module's own default/intended presentation.
  game.settings.register(MODULE_ID, SETTING_DELEGATED_FORMATTING, {
    name: "BTM.SettingDelegatedFormatting",
    hint: "BTM.SettingDelegatedFormattingHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      plain: "BTM.SettingDelegatedFormattingPlain",
      preserve: "BTM.SettingDelegatedFormattingPreserve"
    },
    default: "plain"
  });
}

export function getDelegatedFormattingMode() {
  return game.settings.get(MODULE_ID, SETTING_DELEGATED_FORMATTING) ?? "plain";
}

export function getMenus() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_MENUS) ?? []);
}

export function getMenu(menuId) {
  return getMenus().find(m => m.id === menuId) ?? null;
}

export async function saveMenus(menus) {
  return game.settings.set(MODULE_ID, SETTING_MENUS, menus);
}

/**
 * Every mutating function below does a read-modify-write against the same world
 * setting. Without serialization, two calls firing close together (e.g. a blur-
 * triggered save racing a toggle-button-triggered save, or several chip context-menu
 * actions in quick succession) can both read the same starting snapshot and then write
 * back one after another - the second write silently discards whatever the first one
 * changed, since it never saw it. This queue forces every mutation to fully complete
 * (its own read + modify + write) before the next one starts, which is what actually
 * fixes "sometimes doesn't save" rather than just making it less likely.
 */
let writeChain = Promise.resolve();
function enqueueWrite(fn) {
  const result = writeChain.then(fn, fn);
  writeChain = result.then(
    () => {},
    () => {}
  );
  return result;
}

export async function createMenu(name) {
  return enqueueWrite(async () => {
    const menus = getMenus();
    const menu = {
      id: foundry.utils.randomID(),
      name: name || game.i18n.localize("BTM.NewMenuName"),
      kind: "journal",
      gmRoll: false,
      chipIcons: {},
      chipStyle: {},
      chipScale: {},
      chipBorder: {},
      theme: "light",
      content: ""
    };
    menus.push(menu);
    await saveMenus(menus);
    return menu;
  });
}

export async function updateMenu(menuId, updates) {
  return enqueueWrite(async () => {
    const menus = getMenus();
    const idx = menus.findIndex(m => m.id === menuId);
    if (idx === -1) return null;
    menus[idx] = foundry.utils.mergeObject(menus[idx], updates, { inplace: false });
    await saveMenus(menus);
    return menus[idx];
  });
}

export async function deleteMenu(menuId) {
  return enqueueWrite(async () => {
    const menus = getMenus().filter(m => m.id !== menuId);
    await saveMenus(menus);
  });
}

/** Set the icon source for a given table/macro uuid, menu-wide (same reasoning as
 * chipStyle above - simpler than tracking per-chip-instance state, and a reasonable
 * expectation if the same table is dropped in more than once). Pass `true` to use the
 * table/macro's own configured icon, a file path string for a custom chosen image, or
 * a falsy value to clear back to the generic default icon. */
export async function setChipIcon(menuId, uuid, iconSource) {
  return enqueueWrite(async () => {
    const menus = getMenus();
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return null;
    menu.chipIcons = menu.chipIcons ?? {};
    if (iconSource) menu.chipIcons[uuid] = iconSource;
    else delete menu.chipIcons[uuid];
    await saveMenus(menus);
    return menu;
  });
}

/** Set the chip layout style ("compact" | "icon" | "icon-label") for a given table/macro
 * uuid, menu-wide (same reasoning as setChipIcon above - simpler than per-instance state). */
export async function setChipStyle(menuId, uuid, style) {
  return enqueueWrite(async () => {
    const menus = getMenus();
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return null;
    menu.chipStyle = menu.chipStyle ?? {};
    if (style && style !== "compact") menu.chipStyle[uuid] = style;
    else delete menu.chipStyle[uuid];
    await saveMenus(menus);
    return menu;
  });
}

/** Set the chip display scale ("0.7"|"1"|"1.4"|"2", matching the S/M/L/XL size buttons)
 * for a given table/macro uuid, menu-wide. */
export async function setChipScale(menuId, uuid, scale) {
  return enqueueWrite(async () => {
    const menus = getMenus();
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return null;
    menu.chipScale = menu.chipScale ?? {};
    if (scale && scale !== "1") menu.chipScale[uuid] = scale;
    else delete menu.chipScale[uuid];
    await saveMenus(menus);
    return menu;
  });
}

/** Toggle a thin border (in the current text color) around every chip for a given
 * table/macro uuid, menu-wide. */
export async function setChipBorder(menuId, uuid, showBorder) {
  return enqueueWrite(async () => {
    const menus = getMenus();
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return null;
    menu.chipBorder = menu.chipBorder ?? {};
    if (showBorder) menu.chipBorder[uuid] = true;
    else delete menu.chipBorder[uuid];
    await saveMenus(menus);
    return menu;
  });
}

/** Toggle this menu's color theme between "light" (default) and "dark". */
export async function setMenuTheme(menuId, theme) {
  return enqueueWrite(async () => {
    const menus = getMenus();
    const menu = menus.find(m => m.id === menuId);
    if (!menu) return null;
    menu.theme = theme === "dark" ? "dark" : "light";
    await saveMenus(menus);
    return menu;
  });
}
