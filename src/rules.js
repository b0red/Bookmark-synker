// Offline categorizer: known sites, keywords, and the folders the user already made.
// No network, no AI. Same output shape as the AI categorizers: [{ id, category, tags }].

const DOMAINS = {
  Development: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com', 'npmjs.com', 'pypi.org',
    'developer.mozilla.org', 'docs.microsoft.com', 'learn.microsoft.com', 'dev.to', 'codepen.io', 'jsfiddle.net', 'replit.com',
    'vercel.com', 'netlify.com', 'heroku.com', 'docker.com', 'hub.docker.com', 'nodejs.org', 'python.org', 'rust-lang.org',
    'go.dev', 'w3schools.com', 'regex101.com', 'caniuse.com', 'sourceforge.net', 'nuget.org', 'crates.io', 'readthedocs.io',
    'cloudflare.com', 'aws.amazon.com', 'console.cloud.google.com', 'portal.azure.com', 'digitalocean.com', 'jetbrains.com',
    'code.visualstudio.com', 'visualstudio.microsoft.com', 'gist.github.com', 'huggingface.co', 'kaggle.com'],
  'AI': ['openai.com', 'chatgpt.com', 'claude.ai', 'anthropic.com', 'gemini.google.com', 'perplexity.ai', 'midjourney.com',
    'civitai.com', 'ollama.com', 'stability.ai', 'poe.com', 'character.ai', 'lmarena.ai'],
  Video: ['youtube.com', 'youtu.be', 'vimeo.com', 'twitch.tv', 'dailymotion.com', 'kick.com'],
  Entertainment: ['netflix.com', 'disneyplus.com', 'primevideo.com', 'hbomax.com', 'max.com', 'imdb.com', 'rottentomatoes.com',
    'letterboxd.com', 'crunchyroll.com', 'myanimelist.net', 'tvmaze.com', 'trakt.tv', '9gag.com', 'imgur.com'],
  Music: ['spotify.com', 'soundcloud.com', 'bandcamp.com', 'music.apple.com', 'music.youtube.com', 'last.fm', 'genius.com',
    'discogs.com', 'deezer.com', 'tidal.com', 'ultimate-guitar.com'],
  Shopping: ['amazon.com', 'amazon.de', 'amazon.co.uk', 'ebay.com', 'ebay.de', 'aliexpress.com', 'etsy.com', 'walmart.com',
    'bestbuy.com', 'newegg.com', 'ikea.com', 'temu.com', 'wish.com', 'zalando.de', 'otto.de', 'idealo.de', 'geizhals.de',
    'pricerunner.com', 'bol.com', 'mediamarkt.de', 'alternate.de', 'mindfactory.de'],
  Gaming: ['store.steampowered.com', 'steamcommunity.com', 'epicgames.com', 'gog.com', 'itch.io', 'nexusmods.com',
    'curseforge.com', 'ign.com', 'gamespot.com', 'pcgamer.com', 'polygon.com', 'kotaku.com', 'humblebundle.com',
    'xbox.com', 'playstation.com', 'nintendo.com', 'battle.net', 'ea.com', 'ubisoft.com', 'fandom.com', 'speedrun.com',
    'protondb.com', 'howlongtobeat.com', 'moddb.com'],
  '3D Printing': ['thingiverse.com', 'printables.com', 'myminifactory.com', 'cults3d.com', 'prusa3d.com', 'bambulab.com',
    'makerworld.com', 'thangs.com', 'ultimaker.com', 'creality.com', 'all3dp.com'],
  Community: ['reddit.com', 'old.reddit.com', 'discord.com', 'discord.gg', 'news.ycombinator.com', 'lemmy.world', 'quora.com',
    'tumblr.com', 'forum.', 'community.'],
  Social: ['facebook.com', 'instagram.com', 'twitter.com', 'x.com', 'linkedin.com', 'tiktok.com', 'mastodon.social',
    'bsky.app', 'threads.net', 'pinterest.com', 'snapchat.com', 'whatsapp.com', 'telegram.org', 'web.whatsapp.com'],
  News: ['bbc.com', 'bbc.co.uk', 'cnn.com', 'nytimes.com', 'theguardian.com', 'reuters.com', 'apnews.com', 'washingtonpost.com',
    'spiegel.de', 'zeit.de', 'faz.net', 'sueddeutsche.de', 'tagesschau.de', 'heise.de', 'golem.de', 'theverge.com',
    'arstechnica.com', 'wired.com', 'techcrunch.com', 'engadget.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'npr.org',
    'aljazeera.com', 'news.google.com', 'theregister.com', 'tomshardware.com', 'anandtech.com', 'notebookcheck.net'],
  Reference: ['wikipedia.org', 'wikimedia.org', 'wiktionary.org', 'britannica.com', 'archive.org', 'dictionary.com',
    'merriam-webster.com', 'deepl.com', 'translate.google.com', 'dict.cc', 'leo.org', 'wolframalpha.com', 'linguee.com'],
  Learning: ['coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org', 'skillshare.com', 'duolingo.com', 'brilliant.org',
    'codecademy.com', 'freecodecamp.org', 'pluralsight.com', 'masterclass.com', 'ted.com', 'mit.edu', 'ocw.mit.edu'],
  Finance: ['paypal.com', 'revolut.com', 'wise.com', 'coinbase.com', 'binance.com', 'kraken.com', 'tradingview.com',
    'finance.yahoo.com', 'investing.com', 'morningstar.com', 'n26.com', 'traderepublic.com', 'comdirect.de', 'ing.de',
    'dkb.de', 'sparkasse.de', 'finanzen.net', 'onvista.de', 'justetf.com', 'mint.com'],
  Travel: ['booking.com', 'airbnb.com', 'expedia.com', 'tripadvisor.com', 'skyscanner.net', 'kayak.com', 'hotels.com',
    'google.com/travel', 'rome2rio.com', 'bahn.de', 'flixbus.com', 'ryanair.com', 'lufthansa.com', 'momondo.com'],
  Maps: ['maps.google.com', 'google.com/maps', 'openstreetmap.org', 'bing.com/maps', 'here.com', 'komoot.com', 'strava.com'],
  Productivity: ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'drive.google.com', 'docs.google.com',
    'calendar.google.com', 'notion.so', 'trello.com', 'todoist.com', 'evernote.com', 'dropbox.com', 'onedrive.live.com',
    'office.com', 'microsoft365.com', 'canva.com', 'miro.com', 'asana.com', 'slack.com', 'zoom.us', 'proton.me',
    'protonmail.com', 'icloud.com', 'onenote.com', 'keep.google.com', 'airtable.com', 'clickup.com', 'monday.com'],
  Design: ['figma.com', 'dribbble.com', 'behance.net', 'fonts.google.com', 'coolors.co', 'unsplash.com', 'pexels.com',
    'flaticon.com', 'fontawesome.com', 'adobe.com', 'freepik.com', 'pixabay.com', 'iconify.design', 'colorhunt.co'],
  Tools: ['speedtest.net', 'fast.com', 'virustotal.com', 'smallpdf.com', 'ilovepdf.com', 'convertio.co', 'cloudconvert.com',
    'remove.bg', 'tinypng.com', 'temp-mail.org', 'downdetector.com', 'whatismyipaddress.com', 'bitwarden.com',
    'ninite.com', 'alternativeto.net', 'haveibeenpwned.com', 'web.archive.org', 'pastebin.com', 'wetransfer.com'],
  Health: ['webmd.com', 'mayoclinic.org', 'healthline.com', 'nhs.uk', 'myfitnesspal.com', 'netdoktor.de', 'apotheken-umschau.de'],
  Cooking: ['allrecipes.com', 'chefkoch.de', 'seriouseats.com', 'bonappetit.com', 'epicurious.com', 'food.com',
    'foodnetwork.com', 'bbcgoodfood.com', 'kitchenstories.com', 'budgetbytes.com', 'cooking.nytimes.com', 'tasty.co'],
  Hardware: ['pcpartpicker.com', 'userbenchmark.com', 'techpowerup.com', 'nvidia.com', 'amd.com', 'intel.com',
    'logitech.com', 'corsair.com', 'asus.com', 'msi.com', 'gigabyte.com', 'raspberrypi.com', 'arduino.cc', 'adafruit.com',
    'sparkfun.com', 'digikey.com', 'mouser.com', 'ifixit.com'],
};

// Keywords found in title, URL or folder name. Short words are matched as whole words.
const KEYWORDS = {
  Development: ['programming', 'developer', 'javascript', 'typescript', 'python', 'java', 'c#', 'csharp', 'rust', 'golang',
    'react', 'vue', 'angular', 'node.js', 'nodejs', 'api', 'sdk', 'docs', 'documentation', 'git', 'docker', 'kubernetes',
    'linux', 'bash', 'powershell', 'sql', 'database', 'css', 'html', 'webdev', 'framework', 'library', 'code', 'coding',
    'devops', 'electron', 'unity', 'godot', 'unreal', 'dev'],
  AI: ['ai', 'gpt', 'llm', 'chatbot', 'machine learning', 'neural', 'stable diffusion', 'prompt', 'artificial intelligence'],
  Video: ['video', 'videos', 'stream', 'streaming', 'livestream'],
  Entertainment: ['movie', 'movies', 'film', 'films', 'series', 'tv show', 'anime', 'manga', 'comic', 'comics', 'funny', 'memes', 'watch'],
  Music: ['music', 'song', 'songs', 'lyrics', 'album', 'playlist', 'guitar', 'piano', 'chords', 'band', 'radio', 'podcast'],
  Shopping: ['shop', 'store', 'buy', 'cart', 'deal', 'deals', 'sale', 'price', 'product', 'kaufen', 'angebot'],
  Gaming: ['game', 'games', 'gaming', 'minecraft', 'steam', 'mod', 'mods', 'wiki', 'walkthrough', 'speedrun', 'esports',
    'playthrough', 'xbox', 'playstation', 'nintendo', 'roblox', 'fortnite', 'valheim', 'factorio', 'rpg', 'mmo'],
  '3D Printing': ['3d print', '3d printing', '3d printer', 'filament', 'stl', 'slicer', 'cura', 'prusa', 'ender', 'bambu', 'resin'],
  Cooking: ['recipe', 'recipes', 'rezept', 'rezepte', 'cooking', 'baking', 'bake', 'kitchen', 'food', 'meal', 'bread',
    'sourdough', 'grill', 'bbq', 'vegan', 'dessert', 'kochen', 'backen'],
  Travel: ['travel', 'trip', 'hotel', 'hotels', 'flight', 'flights', 'vacation', 'holiday', 'urlaub', 'reise', 'camping', 'hiking'],
  Finance: ['bank', 'banking', 'finance', 'invest', 'investing', 'stock', 'stocks', 'etf', 'crypto', 'bitcoin', 'tax',
    'taxes', 'budget', 'insurance', 'loan', 'mortgage', 'steuer', 'versicherung'],
  Health: ['health', 'fitness', 'workout', 'exercise', 'diet', 'nutrition', 'medical', 'doctor', 'yoga', 'running', 'gesundheit'],
  Learning: ['course', 'courses', 'tutorial', 'tutorials', 'learn', 'learning', 'lesson', 'lessons', 'guide', 'how to',
    'howto', 'education', 'university', 'study', 'class'],
  'Home & Garden': ['garden', 'gardening', 'plants', 'diy', 'home improvement', 'furniture', 'woodworking', 'renovation',
    'house', 'garten', 'heimwerken', 'smart home', 'home assistant'],
  Hardware: ['hardware', 'gpu', 'cpu', 'motherboard', 'pc build', 'electronics', 'arduino', 'raspberry pi', 'esp32',
    'soldering', 'keyboard', 'mouse', 'monitor', 'nas', 'router'],
  Design: ['design', 'font', 'fonts', 'icons', 'icon', 'color', 'palette', 'ui', 'ux', 'logo', 'illustration', 'photoshop', 'blender'],
  Photography: ['photo', 'photography', 'camera', 'lens', 'lightroom', 'photos'],
  Cars: ['car', 'cars', 'auto', 'vehicle', 'motorcycle', 'tesla', 'ev', 'tuning'],
  Jobs: ['job', 'jobs', 'career', 'resume', 'cv', 'hiring', 'recruit', 'interview', 'salary', 'karriere'],
  Sports: ['football', 'soccer', 'nba', 'nfl', 'tennis', 'cycling', 'bike', 'formula 1', 'f1', 'sports', 'sport'],
  News: ['news', 'nachrichten', 'blog', 'magazine'],
  Software: ['download', 'downloads', 'software', 'app', 'apps', 'tool', 'tools', 'utility', 'freeware', 'windows', 'driver', 'drivers'],
};

// Swedish words, merged into the lists above.
const SWEDISH = {
  Development: ['programmering', 'utveckling', 'webb', 'webbutveckling', 'kod'],
  Video: ['film', 'filmer'],
  Music: ['musik', 'låtar', 'gitarr'],
  Shopping: ['köpa', 'butik', 'handla', 'erbjudande', 'rea', 'pris'],
  Gaming: ['spel', 'datorspel'],
  Cooking: ['recept', 'matlagning', 'mat', 'baka', 'bakning'],
  Travel: ['resor', 'resa', 'semester'],
  Finance: ['ekonomi', 'bank', 'aktier', 'fonder', 'skatt', 'försäkring', 'pension'],
  Health: ['hälsa', 'träning', 'kost'],
  Learning: ['kurs', 'kurser', 'lära', 'utbildning', 'guide', 'guider'],
  'Home & Garden': ['trädgård', 'inredning', 'hem', 'hus', 'renovering', 'snickeri', 'möbler'],
  Hardware: ['teknik', 'lagring', 'dator', 'datorer', 'elektronik'],
  Photography: ['foto', 'bilder', 'kamera', 'fotografi'],
  Cars: ['bil', 'bilar', 'motor'],
  Jobs: ['jobb', 'arbete', 'karriär'],
  News: ['nyheter', 'tidning'],
  Software: ['program', 'nedladdning', 'verktyg'],
  Tools: ['sökning', 'sök'],
};
for (const [cat, words] of Object.entries(SWEDISH)) (KEYWORDS[cat] ||= []).push(...words);
KEYWORDS.Tools ||= [];
KEYWORDS.Hardware.push('nas', 'synology', 'storage');
KEYWORDS.Development.push('drupal', 'wordpress');
KEYWORDS.Linux = ['linux', '*nix', 'unix', 'ubuntu', 'debian', 'fedora', 'red hat', 'redhat', 'centos', 'arch linux', 'mint',
  'bash', 'shell', 'terminal', 'kodi', 'htpc', 'systemd', 'gnome', 'kde', 'distro', 'sudo', 'apt', 'grub', 'samba'];
KEYWORDS.Development = KEYWORDS.Development.filter(w => !['linux', 'bash'].includes(w));
DOMAINS.Linux = ['ubuntu.com', 'askubuntu.com', 'ubuntuforums.org', 'debian.org', 'fedoraproject.org', 'getfedora.org',
  'redhat.com', 'archlinux.org', 'linuxmint.com', 'distrowatch.com', 'kodi.tv', 'omgubuntu.co.uk', 'linuxize.com',
  'cyberciti.biz', 'tecmint.com', 'linux.org', 'kernel.org', 'gnome.org', 'kde.org', 'howtogeek.com', 'unix.stackexchange.com',
  'superuser.com', 'digitalocean.com/community', 'linuxjournal.com', 'phoronix.com', 'itsfoss.com'];

// Root folders that say nothing about the content.
const GENERIC_FOLDERS = new RegExp('^(' + [
  'bookmarks? (bar|menu|toolbar)', 'other bookmarks', 'mobile bookmarks', 'favorites( bar)?', 'imported.*',
  'from (chrome|edge|firefox|ie|internet explorer).*', 'mozilla firefox.*', '.*mozilla firefox', 'new folder', 'misc.*',
  'stuff', 'unsorted', 'temp', 'other', '\\d+',
  // Swedish
  'bokmärkesfältet', 'bokmärkesmeny(n)?', 'menyn bokmärken.*', 'andra bokmärken', 'övriga bokmärken', 'mobila bokmärken',
  'favoritfältet', 'favoriter', 'importerad.*', 'ny mapp', 'övrigt', 'diverse', 'blandat',
  // German
  'lesezeichen.*', 'weitere lesezeichen', 'neuer ordner', 'sonstiges',
].join('|') + ')$', 'iu');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const KEYWORD_RES = Object.entries(KEYWORDS).map(([cat, words]) => ({
  cat,
  words: words.map(w => ({ w, re: new RegExp(w.length <= 4 || /\s/.test(w) ? `(^|[^a-z0-9])${escapeRe(w)}($|[^a-z0-9])` : escapeRe(w), 'i') })),
}));

// Linux sites first, so e.g. unix.stackexchange.com wins over stackexchange.com.
const DOMAIN_LIST = [['Linux', DOMAINS.Linux], ...Object.entries(DOMAINS).filter(([c]) => c !== 'Linux')]
  .flatMap(([cat, ds]) => ds.map(d => ({ cat, d })));

function domainCategory(url, domain) {
  const lower = String(url).toLowerCase();
  for (const { cat, d } of DOMAIN_LIST) {
    if (d.includes('/')) { if (lower.includes(d)) return cat; continue; }
    if (d.endsWith('.')) { if (domain.startsWith(d)) return cat; continue; }
    if (domain === d || domain.endsWith('.' + d)) return cat;
  }
  return null;
}

function meaningfulFolders(folder) {
  return String(folder || '').split(' / ').map(s => s.trim()).filter(s => s && !GENERIC_FOLDERS.test(s));
}

function titleCase(s) {
  // Only the first letter of each word; keeps å/ä/ö and the rest of the word as the user wrote it.
  return s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map(w => w.charAt(0).toLocaleUpperCase() + w.slice(1)).join(' ');
}

function siteTag(domain) {
  const parts = domain.split('.');
  if (parts.length < 2) return null;
  const name = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2];
  return name && name.length > 1 ? name.toLowerCase() : null;
}

function categorizeOne(b) {
  const domain = String(b.domain || '').toLowerCase();
  const folders = meaningfulFolders(b.folder);
  const leafFolder = String(b.folder || '').split(' / ').pop().trim();
  const text = `${b.title || ''} ${String(b.url).replace(/[/._?=&-]+/g, ' ')}`;

  // Score each category: folder keywords count most (the user chose that folder), then known sites, then title/url keywords.
  const scores = new Map();
  const hits = new Map();
  const add = (cat, n, word) => {
    scores.set(cat, (scores.get(cat) || 0) + n);
    if (word) { if (!hits.has(cat)) hits.set(cat, new Set()); hits.get(cat).add(word); }
  };

  const byDomain = domainCategory(b.url, domain);
  if (byDomain) add(byDomain, 5);
  for (const { cat, words } of KEYWORD_RES) {
    for (const { w, re } of words) {
      // The folder the bookmark sits in counts most; parent folders a bit less, so a known site can outvote them.
      // ("*nix / temp": the bookmark is in "temp", so "*nix" only counts as a parent.)
      let folderHit = 0;
      folders.forEach(f => { if (re.test(f)) folderHit = Math.max(folderHit, f === leafFolder ? 6 : 4); });
      if (folderHit) add(cat, folderHit, w);
      if (re.test(text)) add(cat, 2, w);
    }
  }

  let category = null;
  let best = 0;
  for (const [cat, s] of scores) if (s > best) { best = s; category = cat; }

  // Nothing recognised: the user's own top-level folder name is the best guess.
  if (!category && folders.length) category = titleCase(folders[0]).slice(0, 40);
  if (!category) category = 'Other';

  const tags = [];
  const st = siteTag(domain);
  if (st) tags.push(st);
  for (const w of hits.get(category) || []) if (tags.length < 4 && w.toLowerCase() !== category.toLowerCase()) tags.push(w.toLowerCase());
  if (folders.length > 1 && tags.length < 4) {
    const leaf = folders[folders.length - 1].toLowerCase();
    if (leaf.length <= 30 && leaf !== category.toLowerCase()) tags.push(leaf);
  }
  return { id: b.id, category, tags: [...new Set(tags)] };
}

async function categorize({ bookmarks, onBatch }) {
  const results = bookmarks.map(categorizeOne);
  onBatch(results, bookmarks.length, bookmarks.length);
}

module.exports = { categorize, categorizeOne };
