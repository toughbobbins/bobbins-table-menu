import { MODULE_ID } from "./menu-data.js";

function getTextEditor() {
  return foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
}

/** Post a journal menu's content to chat, flagged so our click-handler (in bobbins-table-menu.js)
 * can intercept RollTable content-link clicks and roll them directly instead of opening the sheet. */
export async function postJournalMenuToChat(menu) {
  if (!menu) return;
  const TE = getTextEditor();
  const enriched = await TE.enrichHTML(menu.content ?? "", { async: true });

  const themeClass = menu.theme === "dark" ? " btm-theme-dark" : "";
  return ChatMessage.create({
    content: `<div class="btm-journal-chat-card${themeClass}">${enriched}</div>`,
    speaker: ChatMessage.getSpeaker(),
    flags: {
      [MODULE_ID]: { journalCard: true, menuId: menu.id }
    }
  });
}
