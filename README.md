# Bobbins Table Menu

Curated, editable text-based menus of RollTables and Macros for one-click rolling in
Foundry VTT. Built for Foundry v13 (verified on 13.351, uses the ApplicationV2 API).

## Installing

1. In Foundry's **Add-on Modules** screen, choose **Install Module** and paste this manifest URL
   into the box at the bottom:
   `https://github.com/toughbobbins/bobbins-table-menu/releases/latest/download/module.json`
   (Or copy the `bobbins-table-menu` folder into your Foundry `Data/modules/` directory by hand.)
2. Enable **Bobbins Table Menu** in your world's Manage Modules screen. It is GM-only.

## Getting started

1. Open the RollTables sidebar directory. You'll see a new **"Open Menu List"**
   button in the header — click it to open the menu list.
2. Click **New Menu**. It opens immediately in edit mode.
3. Drag RollTables or Macros from their sidebar directories straight into the text box.
   Each one becomes a small preview "chip" showing its name and an icon — that's exactly
   how it'll look once posted, so you can freely write and format text around it without
   risk of accidentally breaking the link. **Right-click a chip** to rename its label,
   choose its icon (the generic default, the linked table/macro's own configured icon,
   or **any image you pick yourself** via Foundry's file browser), add a border, or
   change its layout: **Compact** (the default small inline row), **Icon** (a large square icon
   only, no visible label), or **Icon + Label** (a large square icon with an editable
   label underneath it — click straight into that label to rename it, no right-click
   needed for that one). Click a chip once to select it (a blue outline shows it's
   selected) - with a chip selected, the font-size dropdown resizes the chip itself,
   alignment buttons align the line it's on, and Delete/Backspace removes it.
4. Write whatever surrounding text you like, and use the toolbar for basic formatting:
   **bold**, *italic*, underline, strikethrough, a font dropdown (every font Foundry
   itself has access to), an exact-pixel size dropdown, left/
   centre/right alignment, and a "clear formatting" button. The table icon opens a
   Word-style grid picker — hover to choose a size, click to insert a real table, then
   drag tables/macros into individual cells and type text around them like anywhere else.
   **Right-click any blank space** in the text for a "Choose Image..." option, which
   opens Foundry's own file browser and drops the picked image straight in at that spot.
5. Click the pen/eye icon (top-right) to switch between edit and live — switching to
   live automatically saves, so there's no separate save button anymore. Chip styles
   you picked carry over correctly to this view and to posted chat messages too, and
   RollTable links roll directly when clicked (Macro links run directly - that's core
   Foundry's own behavior for Macro content links).
6. The share icon ("Send to Chat") posts the current content to chat as one message,
   with the same one-click behavior there too.
7. The two macro-building icons in the title bar generate a hotbar macro for this menu
   (filed into a "Table Launcher Macros" folder in your macro directory, keeping them
   out of the top level):
   - **Build Popup Macro** — running it reopens this menu's editor/view popup.
   - **Build Chat Macro** — running it posts the menu straight to chat, skipping
     the popup entirely. Handy for a menu you just want to fire off in one click.
   You can build both for the same menu if you want either option available.
8. A **Save** button next to the menu name saves your text and links at any point;
   content also autosaves when you leave edit mode, post to chat, or close the popup.
9. Drag one of this module's own menu-opening macros (from step 7) and drop it
   **anywhere on another open menu's window** (outside the text box itself) to jump
   straight to that menu - a quick way to hop between related menus, like Food →
   Weather → Travel, without going back through the menu list each time.

## Dynamic Table Manager compatibility

If a RollTable you drag in is a **Dynamic Table Manager "Advanced Table"**, this module
detects that (via its `dynamic-table-manager` flag data) and interprets the underlying
conditional/output action tree itself, instead of calling core Foundry's plain table
roll (which only sees DTM's placeholder meta-result and errors).

This is a best-effort, reverse-engineered compatibility layer — DTM doesn't expose a
public API, so it was built by inspecting an exported table's JSON. It currently
supports:
- **Conditional** actions (roll a die, branch by result range, optionally loop) —
  including each branch's own label, shown as context alongside its result
- **Output** actions with text content, including inline rolls like `[[1d4 * 1000]] cp`
  — including the output's own label field, shown alongside its value
- Output actions that reference a linked table or document (best-effort; less tested)

If a table uses a DTM action type not listed above, the result will show a visible
`[Unsupported DTM action: ...]` placeholder (logged to console with full detail)
rather than silently producing a wrong result — please share that console output
if you hit one, so support can be added.

## Other "Advanced Table" module compatibility

Same idea as above, but for a different, similarly-named module ("bobbins-tables")
that also stores its real content in flag data rather than core's normal `results`
array — its schema is different from DTM's (conditionals/branches/outputs), and unlike
DTM, its outputs are meant to concatenate into one flowing sentence rather than
separate labeled lines (e.g. "You find 4 Chanterelle Fungi!"). Detected and interpreted
the same reverse-engineered way, from an exported table's JSON. Unsupported output
kinds show the same kind of visible placeholder rather than failing silently.

If a currently-active module exposes its own `api.rollTable(table, options)` for data
it manages (Bobbins Tables does, as of its own recent update), that module is asked to
roll its own table directly instead of this module maintaining a parallel
interpretation of a format it doesn't own - any future table module that adopts this
same lightweight convention (store data under its own flag scope, expose
`api.rollTable()`) gets picked up automatically, no update needed here. By default the
result is stripped to plain text so every table reads the same way regardless of
source - there's a world setting ("Result Formatting", under this module's settings)
to instead preserve that module's own formatting if you'd rather see it as intended.

### Tables that need Bobbins Tables enabled

Tables built with features only Bobbins Tables understands - decision trees such as Hunting
or Sleep Difficulty, for example - can only be rolled while that module is enabled. If it is
switched off, rolling one shows "needs the Bobbins Tables module enabled to roll" instead of
failing quietly. A decision tree shows its own result popup rather than a chat card, so
**GM Roll does not apply to it**, and cancelling its dialogue posts nothing.

**Honest caveat**: the RollTable-link-rolls-instead-of-opens behavior (both in the
popup's view mode and in posted chat messages) relies on Foundry's `renderChatMessageHTML`
hook, a fairly recent core API I couldn't fully test live. If a RollTable link ever
just opens the table sheet instead of rolling it, please tell me exactly what you see
(and any console errors).

## Notes

- **GM-only.** This module is for the GM: the sidebar button is hidden for players, and
  opening a menu or posting one to chat as a player shows "Bobbins Table Menu is GM-only".

- Window size/position for each menu is remembered per-menu across sessions (saved
  when the popup closes, restored the next time you open that specific menu).
- Menu data is stored in a world setting, so every GM sees the same menus.
## License

Copyright (c) 2026 Robert Gill.

Free to use in your own games under the **PolyForm Strict License 1.0.0** (see `LICENSE`):
use for noncommercial purposes is permitted, but you may not distribute copies or make
changes or new works based on it. For anything beyond that, please get in touch first.
