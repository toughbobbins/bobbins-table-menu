const DTM_FLAG_SCOPE = "dynamic-table-manager";

/** True if this RollTable is a DTM "Advanced Table" (real content lives in flags, not
 * `results`). Uses raw flags property access rather than getFlag() - getFlag() validates
 * that its scope argument is a currently active module/system and throws if not, which
 * broke every table roll (not just DTM tables) the moment DTM itself was deactivated. */
export function isAdvancedTable(table) {
  return table?.flags?.[DTM_FLAG_SCOPE]?.tableType === "advanced-table";
}

/**
 * Interpret a DTM Advanced Table's action tree ourselves, since DTM exposes no
 * public API to call into and its actual roll logic isn't reachable from outside.
 * Reverse-engineered from an exported table's flag data and a side-by-side comparison
 * with DTM's own chat card - each top-level (or branch-resolved) output action becomes
 * its own line, formatted as "**label:** value" to match DTM's own layout, rather than
 * one comma-joined paragraph. Unrecognized action types produce a visible placeholder
 * instead of failing silently, so gaps are obvious rather than silently wrong.
 */
export async function rollAdvancedTable(table) {
  const config = table.flags?.[DTM_FLAG_SCOPE]?.advancedTableConfig;
  const rolls = [];
  const lines = [];

  for (const action of config?.actions ?? []) {
    lines.push(...(await runAction(action, rolls)));
  }

  return { lines, rolls };
}

/** Every action resolves to zero or more display lines. */
async function runAction(action, rolls) {
  switch (action.type) {
    case "conditional":
      return runConditional(action, rolls);
    case "output":
      return runOutput(action, rolls);
    default:
      console.warn(`Bobbins Table Menu: unrecognized DTM action type "${action.type}"`, action);
      return [`[Unsupported DTM action: ${action.type}]`];
  }
}

async function runConditional(action, rolls) {
  const loops = Math.max(1, Number(action.loop) || 1);
  const lines = [];

  for (let i = 0; i < loops; i++) {
    const formula = /^\d/.test(action.die) ? action.die : `1${action.die}`;
    const roll = await new Roll(formula).evaluate();
    rolls.push(roll);

    const branch = (action.branches ?? []).find(b => roll.total >= b.low && roll.total <= b.high);
    if (!branch) continue;

    // DTM's own chat output doesn't show the branch's own label (e.g. "Branch 1") at
    // all - only each resolved output action's own label matters, so branch.label is
    // deliberately not included here (an earlier version incorrectly prefixed it).
    for (const sub of branch.actions ?? []) {
      lines.push(...(await runAction(sub, rolls)));
    }
  }

  return lines;
}

async function runOutput(action, rolls) {
  const label = action.label?.trim();
  const value = await runOutputValue(action, rolls);
  if (value === null || value === undefined) return [];
  return [label ? `<strong class="btm-result-label">${label}:</strong> ${value}` : value];
}

async function runOutputValue(action, rolls) {
  if (action.sourceType === "text") {
    return evaluateInlineRolls(action.value ?? "", rolls);
  }

  if (action.sourceType === "table" && action.tableUuid) {
    const subTable = await fromUuid(action.tableUuid);
    if (!subTable) return `[Missing linked table: ${action.tableName ?? action.tableUuid}]`;

    if (isAdvancedTable(subTable)) {
      // The linked table is itself a DTM Advanced Table - resolve it with our own
      // interpreter again (recursively), not core's roll, or we'd hit the same
      // meta-result placeholder one level down. Its lines get flattened into a single
      // value here since they're being used as one field's value in the parent table.
      const nested = await rollAdvancedTable(subTable);
      rolls.push(...nested.rolls);
      return nested.lines.join(", ");
    }

    const draw = await subTable.roll();
    rolls.push(draw.roll);
    return draw.results.map(r => r.name || r.text).join(", ");
  }

  if (action.sourceType === "document" && action.documentUuid) {
    const doc = await fromUuid(action.documentUuid);
    if (!doc) return `[Missing linked document: ${action.documentName ?? action.documentUuid}]`;
    return foundry.utils.getProperty(doc, action.tableField) ?? doc.name;
  }

  console.warn("Bobbins Table Menu: unrecognized DTM output sourceType", action);
  return `[Unsupported DTM output: ${action.sourceType}]`;
}

/** Replace [[formula]] inline-roll syntax in DTM text output with the evaluated total. */
export async function evaluateInlineRolls(text, rolls) {
  const matches = [...text.matchAll(/\[\[(.+?)\]\]/g)];
  let out = text;
  for (const match of matches) {
    const roll = await new Roll(match[1]).evaluate();
    rolls.push(roll);
    out = out.replace(match[0], String(roll.total));
  }
  return out;
}
