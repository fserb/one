/*
 * about.js - meta.about as the info button and the popover it opens.
 *
 * tools/build.js writes this into a game page's header and dev.html puts it in
 * the corner of the window, so both show the same markup, under the game's
 * title and year as the gallery card shows them. The text is plain: a
 * blank line starts a paragraph and [text](url) is a link.
 */

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function about({ about: text, title, date }) {
  if (!text) return "";
  const year = (date ?? "").slice(0, 4);
  const html = text.trim().split(/\n\s*\n/).map((p) =>
    `<p>${
      esc(p.trim()).replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        '<a href="$2">$1</a>',
      )
    }</p>`
  ).join("");
  return `<button class="info" popovertarget="about" aria-label="about">` +
    `<svg viewBox="0 0 24 24" aria-hidden="true">` +
    `<path d="M12 1.5C3 1.5 1.5 3 1.5 12S3 22.5 12 22.5 22.5 21 22.5 12 ` +
    `21 1.5 12 1.5Z" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<circle cx="12" cy="7" r="1.5" fill="currentColor"/>` +
    `<path d="M12 10.5v7.5" stroke="currentColor" stroke-width="2.4"/>` +
    `</svg></button><aside id="about" popover>` +
    `<h2>${esc(title)}<time>${esc(year)}</time></h2>${html}` +
    `<button class="close" popovertarget="about" popovertargetaction="hide">` +
    `close</button></aside>`;
}
