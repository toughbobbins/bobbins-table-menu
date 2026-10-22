import { MODULE_ID, getDelegatedFormattingMode } from "./menu-data.js";
import { isAdvancedTable, rollAdvancedTable } from "./dtm-advanced-table.js";
import { isBobbinsTablesAdvancedTable, rollBobbinsTablesAdvancedTable } from "./bobbins-tables-advanced.js";

/**
 * Generic table-owner delegation, ahead of any module-specific
 * resolver — this is what makes rollSingleTable compatible with any
 * table-managing module, not just DTM or Bobbins Tables specifically,
 * without hard-coding either one's name anywhere.
 *
 * The convention: a table's own `flags` object naturally names every
 * module that has data on it (that's just how Foundry flags work —
 * every module stores its own data under `flags[itsOwnModuleId]`). For
 * each flag namespace present on a table, if a currently-active module
 * with that id exposes `api.rollTable(table, options)`, that module is
 * the authority on how to correctly roll ITS OWN data — ask it directly
 * rather than maintaining a parallel interpretation of a format that
 * isn't ours. Any future table module that adopts this same lightweight
 * convention (store data under your own flag scope, expose
 * `api.rollTable()`) gets picked up automatically, no changes needed
 * here ever again.
 *
 * A well-behaved provider's rollTable() already knows what to do with
 * a table it doesn't specifically manage too (Bobbins Tables' own
 * rollTable(), for instance, falls through to plain native resolution
 * for anything it doesn't recognize) — so this doesn't need its own
 * "does this module actually own this table" check beyond "does a flag
 * for it exist and is the module active."
 */
/** Returned by delegateToOwningModule() when the owning module rolled the table but handed
 * back nothing to display - e.g. a Bobbins Tables decision tree, which shows its own result
 * popup as part of rolling and returns an empty card. Callers treat it as "already shown
 * by the owner, post nothing" rather than posting a blank chat card on top of it. */
const OWNER_HANDLED = Symbol("owner-handled");

async function delegateToOwningModule(table, visited) {
  for (const scope of Object.keys(table.flags ?? {})) {
    const mod = game.modules.get(scope);
    if (!mod?.active || typeof mod.api?.rollTable !== "function") continue;
    try {
      const { html, roll } = await mod.api.rollTable(table, { displayChat: false, _visited: visited });
      // Default (and this module's own intended presentation) is to strip every
      // result down to plain text, so results look the same in a unified way
      // regardless of which module actually owns a given table's data. A world can opt
      // into keeping each module's own formatting instead via the module setting.
      const plain = typeof mod.api.linesOnly === "function" ? mod.api.linesOnly(html) : stripTags(html);
      if (!plain && !roll) {
        // Nothing readable and no dice roll came back: the owning module has already shown
        // its result itself (decision trees do), so there is nothing for us to post.
        console.info(`Bobbins Table Menu: "${scope}" returned an empty result for "${table.name}" - assuming it displayed the result itself.`);
        return OWNER_HANDLED;
      }
      const text = getDelegatedFormattingMode() === "preserve" ? html : plain;
      return { table, text: text || "(no result)", results: [], roll, allRolls: roll ? [roll] : [] };
    } catch (err) {
      console.warn(`Bobbins Table Menu: module "${scope}" owns data on "${table.name}" but its rollTable() failed — falling back to our own resolution.`, err);
    }
  }
  return null;
}

function stripTags(html) {
  return String(html ?? "").replace(/<[^>]+>/g, "").trim();
}

/**
 * Roll a single RollTable by id and return { text, table, results, roll }.
 * Does not draw to chat itself - caller decides output.
 */
export async function rollSingleTable(tableId, _visited = new Set()) {
  const table = game.tables.get(tableId);
  if (!table) {
    ui.notifications.warn(`Bobbins Table Menu: RollTable ${tableId} no longer exists.`);
    return null;
  }

  if (_visited.has(table.id)) {
    return { table, text: `[Circular table reference: ${table.name}]`, results: [], roll: null, allRolls: [] };
  }
  _visited.add(table.id);

  const delegated = await delegateToOwningModule(table, _visited);
  if (delegated === OWNER_HANDLED) return null;
  if (delegated) return delegated;

  // Fallbacks below only matter when no owning module was found active
  // with the api.rollTable() convention — e.g. DTM itself doesn't expose
  // one, so its tables always land here. These stay as hand-rolled
  // interpreters of formats we don't own, kept only because there's no
  // better option for them yet.
  if (isAdvancedTable(table)) {
    const { lines, rolls } = await rollAdvancedTable(table);
    return { table, text: lines.join("<br>"), results: [], roll: rolls[0], allRolls: rolls };
  }

  if (isBobbinsTablesAdvancedTable(table)) {
    const { lines, rolls } = await rollBobbinsTablesAdvancedTable(table);
    if (!lines.length) {
      // This reader only knows one table layout (conditionals with text/table outputs).
      // A table built any other way gives it nothing to roll - say so plainly rather than
      // posting a blank card that looks like a bug.
      console.warn(
        `Bobbins Table Menu: "${table.name}" is a Bobbins Tables table this menu can't roll by itself (Bobbins Tables may be disabled, or the table uses features this menu doesn't read).`
      );
      ui.notifications.warn(
        `Bobbins Table Menu: "${table.name}" needs the Bobbins Tables module enabled to roll.`
      );
      return {
        table,
        text: "(this table needs the Bobbins Tables module enabled to roll)",
        results: [],
        roll: rolls[0],
        allRolls: rolls
      };
    }
    return { table, text: lines.join("<br>"), results: [], roll: rolls[0], allRolls: rolls };
  }

  // A table whose real content lives in another module's data (nothing in core's own
  // results) can't be rolled here while that module is installed but switched off - for
  // example a Bobbins Tables decision tree. Say which module is needed up front, instead
  // of letting core's own "no available results to draw" warning make the table look broken.
  const inactiveOwner = findInactiveOwnerModule(table);
  if (inactiveOwner && table.results.size === 0) {
    ui.notifications.warn(
      `Bobbins Table Menu: "${table.name}" needs the "${inactiveOwner}" module enabled to roll.`
    );
    return {
      table,
      text: `(this table needs the "${inactiveOwner}" module enabled to roll)`,
      results: [],
      roll: null,
      allRolls: []
    };
  }

  // recursive:false - we walk any nested table references ourselves (below) so that
  // a DTM Advanced Table reached via a normal chained-table result also goes through
  // our resolver, instead of core's own (DTM-unaware) chained-roll logic.
  let draw = await table.roll({ recursive: false });

  if (!draw.results.length) {
    // Some tables draw fine with core's own default options but come back empty when
    // recursive is explicitly disabled - rather than trust that as a genuine "nothing
    // left to draw", retry with core's normal default (recursive:true) before
    // concluding that. This matches tables reportedly rolling fine everywhere else in
    // Foundry, just not through this specific recursive:false call.
    try {
      const fallbackDraw = await table.roll();
      if (fallbackDraw.results.length) draw = fallbackDraw;
    } catch (err) {
      console.warn(`Bobbins Table Menu: fallback roll for "${table.name}" also failed`, err);
    }
  }

  const rolls = [draw.roll];
  const pieces = [];

  if (!draw.results.length) {
    ui.notifications.warn(`Bobbins Table Menu: "${table.name}" has no results available to draw.`);
  }

  for (const result of draw.results) {
    const nestedTable = getNestedRollTable(result);
    if (nestedTable) {
      const nested = await rollSingleTable(nestedTable.id, _visited);
      if (nested) {
        pieces.push(nested.text);
        rolls.push(...(nested.allRolls?.length ? nested.allRolls : nested.roll ? [nested.roll] : []));
      }
    } else {
      pieces.push(resultToText(result));
    }
  }

  const text = pieces.length ? pieces.join(", ") : "(no results available on this table)";
  return { table, text, results: draw.results, roll: draw.roll, allRolls: rolls };
}

/** Title of an installed-but-disabled module that has stored data on this table, or null.
 * Only modules Foundry knows about are considered, so system and core flag scopes are never
 * blamed - and a module that is simply not installed can't be named, since there is no way
 * to tell its flags apart from any other leftover data. */
function findInactiveOwnerModule(table) {
  for (const scope of Object.keys(table.flags ?? {})) {
    const mod = game.modules.get(scope);
    if (mod && !mod.active) return mod.title ?? scope;
  }
  return null;
}

/** If a TableResult references another RollTable (a "chained" result), return that table. */
function getNestedRollTable(result) {
  // v13+: TableResult#documentCollection/documentId are deprecated (removed in v15) in
  // favour of a document UUID - check that first, and never touch the old getters on
  // v13+, since merely reading them logs a deprecation warning.
  if (typeof result.documentUuid === "string" && result.documentUuid) {
    const doc = fromUuidSync(result.documentUuid);
    return doc?.documentName === "RollTable" ? doc : null;
  }
  if ((game.release?.generation ?? 13) < 13 && result.documentCollection === "RollTable" && result.documentId) {
    return game.tables.get(result.documentId);
  }
  return null;
}

function resultToText(result) {
  return result.name || result.text || result.description || "";
}

/**
 * Roll every sub-table in a compound entry, then build the narrative text
 * from the entry's template (if set) or by auto-joining the results.
 */
export async function rollCompoundEntry(entry) {
  const rolled = [];
  for (const sub of entry.tables) {
    const draw = await rollSingleTable(sub.tableId);
    if (!draw) continue;
    rolled.push({ key: sub.key, label: sub.label, text: draw.text, table: draw.table });
  }

  let narrative;
  if (entry.template && entry.template.trim().length > 0) {
    narrative = entry.template;
    for (const r of rolled) {
      narrative = narrative.replaceAll(`{${r.key}}`, r.text);
    }
  } else {
    narrative = rolled.map(r => `${r.label}: ${r.text}`).join("; ");
  }

  return { narrative, rolled };
}

/**
 * Execute a menu entry (table, macro, or compound) and route the output
 * to chat or a popup, per the menu/entry's outputMode.
 */
export async function executeEntry(menu, entry) {
  const outputMode = entry.outputMode || menu.outputMode || "chat";

  if (entry.type === "text" || entry.type === "header") return; // not rollable

  if (entry.type === "macro") {
    const macro = game.macros.get(entry.macroId);
    if (!macro) {
      ui.notifications.warn(`Bobbins Table Menu: Macro ${entry.macroId} no longer exists.`);
      return;
    }
    return macro.execute();
  }

  if (entry.type === "table") {
    const draw = await rollSingleTable(entry.tableId);
    if (!draw) return;
    await deliverResult({
      title: entry.label || draw.table.name,
      text: draw.text,
      outputMode,
      roll: draw.roll,
      allRolls: draw.allRolls,
      gmRoll: menu.gmRoll
    });
    return;
  }

  if (entry.type === "compound") {
    const { narrative } = await rollCompoundEntry(entry);
    await deliverResult({
      title: entry.label,
      text: narrative,
      outputMode,
      gmRoll: menu.gmRoll
    });
    return;
  }
}

async function deliverResult({ title, text, outputMode, roll, allRolls, gmRoll }) {
  if (outputMode === "popup") {
    return showResultPopup(title, text);
  }
  return postToChat(title, text, allRolls?.length ? allRolls : roll, { whisperGM: !!gmRoll });
}

/** Foundry's ChatMessage validation rejects any Roll that hasn't been evaluated - a
 * RollTable with no available results to draw (empty results array, or replacement:
 * false with everything already drawn) returns a Roll object that was constructed but
 * never actually evaluated, which otherwise crashes ChatMessage.create() outright and
 * blocks the message (including the actual result text) from posting at all. This
 * evaluates anything that still needs it, and quietly drops anything that genuinely
 * can't be evaluated rather than letting the whole chat message fail. */
async function ensureEvaluatedRolls(rolls) {
  const evaluated = [];
  for (const roll of rolls) {
    if (!roll) continue;
    if (roll._evaluated) {
      evaluated.push(roll);
      continue;
    }
    try {
      await roll.evaluate();
      evaluated.push(roll);
    } catch (err) {
      console.warn(
        "Bobbins Table Menu: dropping a Roll that couldn't be evaluated (the table likely had no results available to draw)",
        err
      );
    }
  }
  return evaluated;
}

export async function postToChat(title, text, rollOrRolls, { whisperGM = false } = {}) {
  const rawRolls = Array.isArray(rollOrRolls) ? rollOrRolls : rollOrRolls ? [rollOrRolls] : [];
  // Belt-and-braces on top of ensureEvaluatedRolls itself: filter strictly on
  // _evaluated one more time right before use, since this exact "Roll objects added to
  // ChatMessage documents must be evaluated" crash has proven persistent - anything
  // that still isn't truly evaluated at this point is silently dropped rather than
  // risking the whole chat message failing to post.
  const rolls = (await ensureEvaluatedRolls(rawRolls)).filter(r => r._evaluated);
  const content = `<div class="btm-chat-result"><h3>${title}</h3><p>${text}</p></div>`;
  const messageData = {
    content,
    speaker: ChatMessage.getSpeaker(),
    rolls: rolls.length ? rolls : undefined,
    sound: rolls.length ? CONFIG.sounds.dice : undefined
  };
  // Respect whatever roll mode is currently selected in Foundry's own chat box (Public/
  // Private GM/Blind GM/Self) by default, so that control still works as normal.
  const rollMode = whisperGM ? "gmroll" : game.settings.get("core", "rollMode");
  ChatMessage.applyRollMode(messageData, rollMode);

  // Belt-and-braces: force the whisper explicitly when the GM Roll checkbox is on,
  // rather than relying solely on applyRollMode's own "gmroll" handling - that alone
  // wasn't reliably taking effect for this menu's checkbox.
  if (whisperGM) {
    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
    if (gmIds.length) {
      messageData.whisper = gmIds;
      messageData.blind = false;
    }
  }

  return ChatMessage.create(messageData);
}

function showResultPopup(title, text) {
  new foundry.applications.api.DialogV2({
    window: { title },
    content: `<div class="btm-popup-result"><p>${text}</p></div>`,
    buttons: [
      {
        action: "close",
        label: "Close",
        default: true,
        callback: () => {}
      }
    ]
  }).render(true);
}
