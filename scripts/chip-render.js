/** Build just the inner content (icon + optional label) for a chip's current style.
 * `escapedLabel` must already be HTML-safe. */
export function buildChipInnerHtml(uuid, escapedLabel, imgSrc, style, labelEditable) {
  const icon = iconHtml(uuid, imgSrc, style !== "compact");
  if (style === "icon") return icon;
  if (style === "icon-label") {
    const editAttr = labelEditable ? ' contenteditable="true"' : "";
    return `${icon}<span class="btm-chip-label"${editAttr}>${escapedLabel}</span>`;
  }
  return `${icon}${escapedLabel}`;
}

export function iconHtml(uuid, imgSrc, large) {
  const sizeClass = large ? "btm-chip-icon-large" : "btm-chip-icon";
  const sizeStyle = large
    ? ` style="width: calc(48px * var(--btm-chip-scale, 1)) !important; height: calc(48px * var(--btm-chip-scale, 1)) !important; display: block !important; object-fit: cover !important;"`
    : "";
  if (imgSrc) return `<img class="${sizeClass}" src="${escapeHtml(imgSrc)}" alt="" draggable="false"${sizeStyle} />`;
  const type = uuid.split(".")[0];
  const icon = type === "Macro" ? "fa-bolt" : "fa-dice-d20";
  const iStyle = large
    ? ` style="width: calc(48px * var(--btm-chip-scale, 1)) !important; height: calc(48px * var(--btm-chip-scale, 1)) !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: calc(1.8em * var(--btm-chip-scale, 1)) !important;"`
    : "";
  return `<i class="fa-solid ${icon} ${sizeClass}"${iStyle}></i>`;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
