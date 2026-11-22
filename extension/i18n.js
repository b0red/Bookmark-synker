// Translations for the popup, chosen from the browser's language. The English text is the key:
// t('Deleted {n} bookmarks.', { n }) gives the Swedish text in a Swedish browser, English otherwise.
// popup.html is translated once when it opens; text with inline markup is matched as a whole.

const SV_POPUP = {
  'Allow access to the app.': 'Ge åtkomst till appen.',
  'The helper talks only to Bookmark syncer on this PC (127.0.0.1). Firefox asks you to allow that once.': 'Hjälpen pratar bara med Bookmark syncer på den här datorn (127.0.0.1). Firefox ber dig tillåta det en gång.',
  'Not allowed. Click the button again and choose Allow.': 'Inte tillåtet. Klicka på knappen igen och välj Tillåt.',
  'Allow': 'Tillåt',
  'Paste the <b>pairing code</b> from the app: <i>Sync to browsers → Set up the browser extension</i>.': 'Klistra in <b>kopplingskoden</b> från appen: <i>Synka till webbläsare → Ställ in webbläsartillägget</i>.',
  'Connect': 'Anslut',
  "Bookmark syncer isn't running.": 'Bookmark syncer är inte igång.',
  'Open the app on this PC, then try again.': 'Öppna appen på den här datorn och försök igen.',
  'Try again': 'Försök igen',
  'Category': 'Kategori',
  'Uncategorized': 'Utan kategori',
  'Tags <span class="muted">(comma separated)</span>': 'Taggar <span class="muted">(kommaseparerade)</span>',
  'Notes': 'Anteckningar',
  'Why did you save this?': 'Varför sparade du den här?',
  'Read later': 'Läs senare',
  'Save to library': 'Spara i biblioteket',
  'Save changes': 'Spara ändringar',
  'Delete them in this browser': 'Ta bort dem i den här webbläsaren',
  'Deleted through the browser itself, so your browser account sync removes them on your other devices too. You can undo the last run here.': 'De tas bort via webbläsaren själv, så webbläsarkontots synkning tar bort dem på dina andra enheter också. Du kan ångra den senaste körningen här.',
  'Undo': 'Ångra',
  'Sort into folders by category…': 'Sortera i mappar efter kategori…',
  'Sort them': 'Sortera dem',
  'Undo sorting': 'Ångra sorteringen',
  'Back': 'Tillbaka',
  'Bookmarks are only moved, never deleted, into a <i>Bookmark syncer</i> folder under Other bookmarks, one folder per category. Folders they leave empty can be removed. Undo puts everything back, folders too. Your browser sync moves them on your other devices too.': 'Bokmärkena flyttas bara, tas aldrig bort, till en mapp <i>Bookmark syncer</i> under Andra bokmärken, en mapp per kategori. Mappar som blir tomma kan tas bort. Ångra lägger tillbaka allt, mapparna också. Webbläsarens synkning flyttar dem på dina andra enheter också.',
  'Remove folders that end up empty': 'Ta bort mappar som blir tomma',
  'Removed 1 empty folder.': 'Tog bort 1 tom mapp.',
  'Removed {n} empty folders.': 'Tog bort {n} tomma mappar.',
  'Change pairing code': 'Byt kopplingskod',
  // popup.js
  'Could not reach the app. Is Bookmark syncer open?': 'Kunde inte nå appen. Är Bookmark syncer öppen?',
  'The app answered with error {status}.': 'Appen svarade med fel {status}.',
  'Connecting…': 'Ansluter…',
  'Connected to {app} {version}': 'Ansluten till {app} {version}',
  'The pairing code changed in the app. Paste the new one.': 'Kopplingskoden har ändrats i appen. Klistra in den nya.',
  'Not connected': 'Inte ansluten',
  '<b>All clean.</b> None of the {n} bookmarks you deleted in the app are in {browser}.': '<b>Allt är rent.</b> Inget av de {n} bokmärken du tagit bort i appen finns i {browser}.',
  'Undo last run ({n})': 'Ångra senaste körningen ({n})',
  '<b>1 bookmark</b> in {browser} was deleted in Bookmark syncer:': '<b>1 bokmärke</b> i {browser} har tagits bort i Bookmark syncer:',
  '<b>{n} bookmarks</b> in {browser} were deleted in Bookmark syncer:': '<b>{n} bokmärken</b> i {browser} har tagits bort i Bookmark syncer:',
  '… and {n} more': '… och {n} till',
  "That code doesn't match. Copy it again from the app.": 'Koden stämmer inte. Kopiera den igen från appen.',
  'Deleting…': 'Tar bort…',
  '<b>Deleted 1 bookmark.</b>': '<b>Tog bort 1 bokmärke.</b>',
  '<b>Deleted {n} bookmarks.</b>': '<b>Tog bort {n} bokmärken.</b>',
  "{n} couldn't be deleted (managed by your organization or read-only).": '{n} gick inte att ta bort (hanteras av din organisation eller är skrivskyddade).',
  'Your browser sync will remove them on your other devices.': 'Webbläsarens synkning tar bort dem på dina andra enheter.',
  '<b>Put back 1 bookmark.</b>': '<b>Lade tillbaka 1 bokmärke.</b>',
  '<b>Put back {n} bookmarks.</b>': '<b>Lade tillbaka {n} bokmärken.</b>',
  'To keep them for good, also restore them under <i>Recently deleted</i> in the app.': 'För att behålla dem för gott, återställ dem också under <i>Nyligen borttagna</i> i appen.',
  'In your library': 'Finns i ditt bibliotek',
  'Not in your library yet': 'Finns inte i ditt bibliotek än',
  'Added to your library.': 'Tillagd i ditt bibliotek.',
  'Saved.': 'Sparat.',
  'Not saved: {error}': 'Inte sparat: {error}',
  'Looking at your categories…': 'Tittar på dina kategorier…',
  'Could not reach the app.': 'Kunde inte nå appen.',
  '<b>No categories yet.</b> Categorize bookmarks in the app first.': '<b>Inga kategorier än.</b> Kategorisera bokmärken i appen först.',
  '<b>All sorted.</b> Every categorized bookmark in {browser} is in its category folder.': '<b>Allt är sorterat.</b> Varje kategoriserat bokmärke i {browser} ligger i sin kategorimapp.',
  '1 bookmark': '1 bokmärke',
  '{n} bookmarks': '{n} bokmärken',
  '1 folder': '1 mapp',
  '{n} folders': '{n} mappar',
  'Move <b>{bookmarks}</b> into {folders}:': 'Flytta <b>{bookmarks}</b> till {folders}:',
  'Sorting…': 'Sorterar…',
  '<b>Sorted {bookmarks}.</b>': '<b>Sorterade {bookmarks}.</b>',
  "{n} couldn't be moved (managed or read-only).": '{n} gick inte att flytta (hanteras centralt eller är skrivskyddade).',
  'Find them under <i>{path}</i>.': 'Du hittar dem under <i>{path}</i>.',
  '<b>Moved {bookmarks} back</b> to where they were.': '<b>Flyttade tillbaka {bookmarks}</b> dit de var.',
  'Other bookmarks': 'Andra bokmärken',
};

(function () {
  const ui = ((globalThis.browser || globalThis.chrome)?.i18n?.getUILanguage?.() || navigator.language || 'en').toLowerCase();
  const dict = ui.startsWith('sv') ? SV_POPUP : {};
  const has = (k) => k && Object.prototype.hasOwnProperty.call(dict, k);
  const fill = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
  globalThis.t = (s, v) => fill(has(s) ? dict[s] : s, v);
  globalThis.tn = (n, one, many, v) => globalThis.t(n === 1 ? one : many, { n, ...v });
  if (!ui.startsWith('sv')) return;

  document.documentElement.lang = 'sv';
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const INLINE = new Set(['B', 'I', 'EM', 'STRONG', 'CODE', 'KBD', 'A', 'SPAN', 'BR', 'SMALL']);
  function attrs(el) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v && has(norm(v))) el.setAttribute(a, dict[norm(v)]);
    }
  }
  function visit(el) {
    attrs(el);
    if (el.tagName === 'SCRIPT') return;
    const kids = [...el.children];
    if (kids.length && kids.every(k => INLINE.has(k.tagName)) && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) {
      const key = norm(el.innerHTML);
      if (has(key)) { el.innerHTML = dict[key]; return; }
    }
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) {
        const key = norm(n.textContent);
        if (has(key)) n.textContent = n.textContent.replace(n.textContent.trim(), dict[key]);
      } else if (n.nodeType === 1) visit(n);
    }
  }
  visit(document.body);
})();
