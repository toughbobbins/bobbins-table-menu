import { evaluateInlineRolls, isAdvancedTable, rollAdvancedTable } from "./dtm-advanced-table.js";

const BT_FLAG_SCOPE = "bobbins-tables";

/**
 * FALLBACK ONLY as of the roller.js update that added delegateToOwningModule():
 * Bobbins Tables now exposes a real api.rollTable(), which roller.js calls
 * directly when that module is active — this hand-rolled interpreter only
 * ever runs if Bobbins Tables is absent, inactive, or running a version old
 * enough not to expose the API yet. Kept for that case rather than removed,
 * but no longer the primary path, and won't need to chase every future
 * change to that module's internal data format the way it did before.
 *
 * True if this RollTable is a "bobbins-tables" module Advanced Table (a
 * different, similarly-named module from Dynamic Table Manager, with its
 * own distinct schema). Uses raw flags property access rather than
 * getFlag() - getFlag() validates that its scope argument is a currently
 * active module and throws if not, which would break every table roll
 * (not just these tables) the moment that module was deactivated.
 */
export function isBobbinsTablesAdvancedTable(table) {
  return table?.flags?.[BT_FLAG_SCOPE]?.tableType === "advanced-table";
}

/**
 * Interpret a "bobbins-tables" Advanced Table's conditional/branch/output tree
 * ourselves, the same reverse-engineered approach used for DTM tables, since this is a
 * separate module exposing no public API either. Reverse-engineered from an exported
 * table's flag data. Outputs within one branch normally concatenate into a single
 * flowing sentence (e.g. text + a nested table roll + more text = "You find 4
 * Chanterelle Fungi!") - but an output with its own Label breaks out of that flow onto
 * its own line instead, styled to match a labeled field (bold, slightly faded label,
 * same idea as DTM's labeled-line output). Each conditional's resulting line(s) join
 * with the next conditional's by <br>. Unrecognized output kinds produce a visible
 * placeholder instead of failing silently.
 */
export async function rollBobbinsTablesAdvancedTable(table) {
  const config = table.flags?.[BT_FLAG_SCOPE]?.advancedTableConfig;
  const rolls = [];
  const lines = [];

  for (const conditional of config?.conditionals ?? []) {
    lines.push(...(await runConditional(conditional, rolls)));
  }

  return { lines, rolls };
}

async function runConditional(conditional, rolls) {
  const formula = /^\d/.test(conditional.die) ? conditional.die : `1${conditional.die}`;
  const roll = await new Roll(formula).evaluate();
  rolls.push(roll);

  // This format's own chat output doesn't show the branch's own label (e.g. "Branch 1")
  // either, matching the same behavior confirmed for DTM - only each output's own
  // label (if it has one) matters.
  const branch = (conditional.branches ?? []).find(b => roll.total >= b.low && roll.total <= b.high);
  if (!branch) return [];

  const lines = [];
  let sentence = "";
  for (const output of branch.outputs ?? []) {
    const value = await runOutput(output, rolls);
    if (!value) continue;

    const label = output.label?.trim();
    if (label) {
      // A labeled output breaks out onto its own line rather than joining the sentence.
      if (sentence) {
        lines.push(sentence);
        sentence = "";
      }
      lines.push(`<strong class="btm-result-label">${escapeHtml(label)}:</strong> ${value}`);
    } else {
      sentence += value;
    }
  }
  if (sentence) lines.push(sentence);

  return lines;
}

async function runOutput(output, rolls) {
  if (output.kind === "text") {
    return evaluateInlineRolls(output.value ?? "", rolls);
  }

  if (output.kind === "table" && output.uuid) {
    const subTable = await fromUuid(output.uuid);
    if (!subTable) return `[Missing linked table: ${output.name ?? output.uuid}]`;

    if (isBobbinsTablesAdvancedTable(subTable)) {
      // Nested "bobbins-tables" Advanced Table - resolve recursively through this same
      // interpreter, not core's roll, or we'd hit an empty-results table one level down.
      const nested = await rollBobbinsTablesAdvancedTable(subTable);
      rolls.push(...nested.rolls);
      return nested.lines.join(" ");
    }

    if (isAdvancedTable(subTable)) {
      // Nested DTM Advanced Table instead - resolve through that interpreter.
      const nested = await rollAdvancedTable(subTable);
      rolls.push(...nested.rolls);
      return nested.lines.join(", ");
    }

    const draw = await subTable.roll();
    rolls.push(draw.roll);
    return draw.results.map(r => r.name || r.text).join(", ");
  }

  console.warn(`Bobbins Table Menu: unrecognized bobbins-tables output kind "${output.kind}"`, output);
  return `[Unsupported output: ${output.kind}]`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
