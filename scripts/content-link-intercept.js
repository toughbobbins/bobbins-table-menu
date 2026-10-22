import { rollSingleTable, postToChat } from "./roller.js";
import { buildChipInnerHtml, escapeHtml } from "./chip-render.js";

/**
 * Apply the same chip visual styling (compact/icon/icon-label, own-icon vs default)
 * used in the edit-mode preview to the FINAL rendered content too. Needed because
 * Foundry's enrichHTML() only knows the standard @UUID content-link format - it has no
 * idea about our per-uuid style/icon preferences, so without this the live/chat output
 * always reverted to Foundry's plain default look regardless of what was chosen while
 * editing. Keeps data-uuid/data-type/href intact throughout, so interceptRollTableLinks
 * (RollTable rolling) and Foundry's own default Macro-execute-on-click both still work
 * afterward - only the inner content/classes change, not the link's core identity.
 */
/** Resolve a chip's icon source: absent/false = generic default icon (no img), `true` =
 * the linked table/macro's own configured icon (needs an async lookup), or a string =
 * a custom image path the user picked directly, already known with no lookup needed. */
export async function resolveChipIconSrc(uuid, iconSetting) {
  if (!iconSetting) return null;
  if (typeof iconSetting === "string") return iconSetting;
  const doc = await fromUuid(uuid).catch(() => null);
  return doc?.img ?? null;
}

export async function applyChipStyling(root, menu) {
  const links = [...root.querySelectorAll("a.content-link[data-uuid]")];
  for (const link of links) {
    const uuid = link.dataset.uuid;
    const style = menu?.chipStyle?.[uuid] || "compact";
    const iconSetting = menu?.chipIcons?.[uuid];
    const scale = menu?.chipScale?.[uuid] || "1";
    const showBorder = !!menu?.chipBorder?.[uuid];

    // Always show the actual table/macro name on hover, overriding Foundry's own
    // default tooltip (which just names the document type, e.g. "RollTable") - both
    // the native title attribute and Foundry's own data-tooltip system need setting,
    // since either could be what's actually rendering the hover text.
    const realName = (link.textContent || uuid).trim();
    link.title = realName;
    link.dataset.tooltip = realName;

    if (style === "compact" && !iconSetting && scale === "1" && !showBorder) continue; // nothing else to change

    const imgSrc = await resolveChipIconSrc(uuid, iconSetting);

    const escapedLabel = escapeHtml(realName);
    link.classList.add(`btm-chip-style-${style}`);
    link.innerHTML = buildChipInnerHtml(uuid, escapedLabel, imgSrc, style, false);
    if (scale !== "1") link.style.setProperty("--btm-chip-scale", scale);
    if (showBorder) applyChipButtonLook(link);

    // Force the outer link's own layout/overflow via inline !important - Foundry's
    // chat log applies its own more specific text-truncation CSS to content-links
    // (sized for a text label), which plain stylesheet !important rules weren't
    // reliably beating; an inline !important declaration beats any external
    // stylesheet rule regardless of its own specificity, which a plain external
    // !important rule can still lose to another external !important rule with a
    // more specific selector or later source order.
    if (style !== "compact") {
      link.style.setProperty("display", "inline-flex", "important");
      link.style.setProperty("flex-direction", "column", "important");
      link.style.setProperty("overflow", "visible", "important");
      link.style.setProperty("text-overflow", "clip", "important");
      link.style.setProperty("max-width", "none", "important");
      link.style.setProperty("min-width", "0", "important");
    }
  }
}

/** The "Add Border" option recreates the classic rounded/beveled button look content
 * links used to have by default, rather than a plain flat line - rounded corners plus
 * a subtle light/dark inset shadow to suggest a raised button edge. */
export function applyChipButtonLook(el) {
  el.style.setProperty("border-color", "currentColor", "important");
  el.style.setProperty("border-radius", "5px", "important");
  el.style.setProperty(
    "box-shadow",
    "inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.3), 0 1px 1px rgba(0,0,0,0.15)",
    "important"
  );
}

/**
 * Make RollTable content links roll the table directly instead of opening its sheet
 * (the default content-link behavior). Used both for posted journal-menu chat cards
 * and the journal-menu popup's own view-mode display.
 *
 * Foundry handles ".content-link" clicks via its own global listener, which runs
 * regardless of any click listener attached directly to the link afterwards - so
 * preventDefault()/stopPropagation() from a listener added here can't reliably stop it.
 * Instead, strip every attribute/class Foundry's handler could plausibly key off of (not
 * just the "content-link" class) and restyle the link ourselves to look the same, then
 * attach our own roll handler - now the only thing listening.
 */
export function interceptRollTableLinks(root, gmRoll = false) {
  root.querySelectorAll('a.content-link[data-type="RollTable"]').forEach(link => {
    if (link.dataset.btmIntercepted) return;

    const uuid = link.dataset.uuid;
    if (!uuid) return;

    link.removeAttribute("data-uuid");
    link.removeAttribute("data-type");
    link.removeAttribute("data-id");
    link.removeAttribute("data-pack");
    link.removeAttribute("data-link");
    link.removeAttribute("href");
    link.classList.remove("content-link");
    link.classList.add("btm-rolltable-link");
    link.dataset.btmUuid = uuid;
    link.dataset.btmIntercepted = "true";

    link.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      const table = await fromUuid(link.dataset.btmUuid);
      if (!table) {
        ui.notifications.warn("Bobbins Table Menu: that RollTable no longer exists.");
        return;
      }
      const draw = await rollSingleTable(table.id);
      if (!draw) return;
      await postToChat(draw.table.name, draw.text, draw.allRolls?.length ? draw.allRolls : draw.roll, {
        whisperGM: gmRoll
      });
    });
  });
}
