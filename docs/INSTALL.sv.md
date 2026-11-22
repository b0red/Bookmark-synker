# Installera och komma igång med Bookmark syncer

[English](INSTALL.md)

## Alternativ A: installationsprogrammet (enklast)

1. Hämta `Bookmark-syncer-Setup-<version>.exe` (från projektets sida Releases, eller bygg det själv, se nedan).
2. Kör det. Windows kan visa **"Windows skyddade datorn"**, eftersom installationsprogrammet inte är signerat med ett betalt certifikat. Klicka på **Mer information → Kör ändå**.
3. Välj var appen ska installeras (din användarmapp som standard, inga administratörsrättigheter behövs) och slutför. Den får en post i Start-menyn och en genväg på skrivbordet.
4. Fortsätt med [4. Importera dina bokmärken](#4-importera-dina-bokmärken).

Biblioteket ligger i `%APPDATA%\Bookmark syncer\`, samma ställe som när du kör från källkoden, så du kan byta mellan dem och behålla allt. Avinstallation (Windows Inställningar → Appar) behåller också biblioteket.

**Bygg installationsprogrammet själv** (kräver steg 1–3 nedan en gång):

```powershell
npm run dist
```

Det skriver `dist\Bookmark-syncer-Setup-<version>.exe`.

### Microsoft Store-versionen

Bookmark syncer är också inskickad till Microsoft Store, under namnet *bookmarker*. Det är samma app, med tre skillnader:

- Microsoft signerar den, så ingen SmartScreen-varning visas, och Store installerar uppdateringar själv. (Därför finns inget avsnitt *Uppdateringar* i dess inställningar.)
- *Starta med Windows* är ingen kryssruta i appen. Slå på det i Windows Inställningar → Appar → Autostart (eller Aktivitetshanteraren → Autostartsappar). Startad så hamnar appen i meddelandefältet. (Windows kan inte tala om för appen att den startades vid inloggning, så den går efter tiden sedan Windows startade: inom de första 3 minuterna startar den i meddelandefältet, senare öppnar den sitt fönster.)
- Den använder samma biblioteksmapp, `%APPDATA%\Bookmark syncer\`, så du kan byta mellan Store-versionen och installationsprogrammet. Kör inte båda samtidigt.

För att bygga Store-paketet själv: `npm run dist:store` (skriver `dist\Bookmark-syncer-<version>-Store.appx`). Bara Store kan installera det, eftersom det inte är signerat.

## Alternativ B: kör från källkoden

## 1. Installera Node.js

Ladda ner och installera **LTS**-versionen från <https://nodejs.org> (version 20 eller nyare). Behåll standardvalen.

Kontrollera att det fungerar i ett nytt PowerShell-fönster:

```powershell
node --version
```

## 2. Hämta appen

**Med Git:**

```powershell
git clone https://github.com/b0red/Bookmark-synker.git bookmark-syncer
cd bookmark-syncer
```

**Utan Git:** på GitHub-sidan, klicka på **Code → Download ZIP**, packa upp den och öppna PowerShell i den uppackade mappen.

## 3. Installera och starta

```powershell
npm install
npm start
```

`npm install` laddar ner Electron (ungefär 100 MB) första gången. Sedan räcker `npm start`.

> **Tips:** lägg projektet någonstans i din användarmapp (till exempel `C:\Users\<du>\Projekt`). Electron kan misslyckas med att starta från vissa skyddade system- eller temp-mappar.

## 4. Importera dina bokmärken

1. Klicka på **Importera**. Appen visar alla webbläsarprofiler den hittade på datorn: Chrome, Edge, Brave, Vivaldi, Opera, Chromium och Comet, och Firefox, Zen, Floorp och Waterfox. Bara webbläsare du har installerade visas.
2. Bocka för de du vill ha och klicka på **Importera valda**.
3. Har du bokmärken från en annan dator eller webbläsare? Exportera dem där som `bookmarks.html` och använd **Importera en bookmarks.html-fil…**

Om Firefox (eller Zen, Floorp, Waterfox) säger att filen är låst: stäng webbläsaren och försök igen.

**DuckDuckGo** sparar sina bokmärken krypterade (med samma nyckel som de sparade lösenorden), och appen öppnar dem inte. Importera dem från en export i stället:

1. I DuckDuckGo: exportera bokmärkena till en HTML-fil (öppna **Manage bookmarks**, sedan **Export bookmarks**) och spara den i mappen **Hämtade filer** (Downloads).
2. I Bookmark syncer: klicka på **Importera**. När DuckDuckGo är installerat har dialogen en ruta för DuckDuckGo. Klicka på **Hitta exporten**. Appen letar i Hämtade filer efter den nyaste bokmärkesexporten från de senaste 7 dagarna och visar namnet och när den sparades. (Hittades inget? Kontrollera att filen ligger i Hämtade filer och är mindre än en vecka gammal, eller välj den var som helst med **Importera en bookmarks.html-fil…**.)
3. Klicka på **Importera den**. Bokmärkena läggs till med källan *DuckDuckGo · export*; dubbletter slås ihop.

Gör om det när du vill ha DuckDuckGos senaste bokmärken; bara nya läggs till. Appen läser bara filer som verkligen är bokmärkesexporter (den kollar de första raderna), och bara i Hämtade filer. Det sker inte automatiskt, och *Synka till webbläsare* och tillägget fungerar inte med DuckDuckGo, så ta bort bokmärken där själv.

**Hittas inte?** Webbläsare som är installerade på ett ovanligt ställe (en portabel kopia, en egen profilmapp) hittas inte. Exportera en `bookmarks.html` från dem i stället.

## 5. Välj hur bokmärkena ska kategoriseras

Öppna **⚙** (uppe till höger) och välj en motor. Välj sedan en vy (till exempel **Utan kategori**) och klicka på **Kategorisera automatiskt**.

### Inbyggda regler (standard)

Fungerar direkt och offline. Känner igen vanliga webbplatser, nyckelord på engelska, svenska och tyska, och namnen på dina egna bokmärkesmappar. Det den inte kan placera hamnar under **Other**.

### Lokal AI (Ollama): gratis och privat

1. Installera Ollama från <https://ollama.com/download>.
2. Ladda ner en modell i PowerShell (ungefär 2 GB):
   ```powershell
   ollama pull qwen2.5:3b
   ```
3. I ⚙ Inställningar, välj **Lokal AI (Ollama)**. Statusraden ska säga att modellen är redo.

På processorn tar det ungefär 15–30 minuter för ~750 bokmärken. Med ett fungerande grafikkort går det mycket fortare.

Andra modeller fungerar också: skriv namnet i rutan *Ollama-modell* (till exempel `llama3.2:3b`, eller `qwen2.5:7b` för bättre resultat på en snabb dator) och kör `ollama pull` på den först.

### Claude: bäst resultat

1. Skapa en API-nyckel på <https://console.anthropic.com> (kontot behöver krediter).
2. I ⚙ Inställningar, välj **Claude**, klistra in nyckeln och klicka på **Spara nyckeln**. Den sparas krypterad med ditt Windows-konto.

Du kan också sätta miljövariabeln `ANTHROPIC_API_KEY` i stället för att spara nyckeln.

## 6. Ta bort bokmärken i webbläsarna också

Att ta bort i appen tar bara bort bokmärken ur biblioteket. För att ta bort dem i webbläsarna också:

1. Ta bort bokmärken i appen (markera dem och klicka på **Ta bort markerade**, eller högerklicka på en städvy → *Ta bort alla*).
2. **Stäng webbläsarna helt.** Edge och Chrome fortsätter ofta köra i meddelandefältet. Högerklicka på deras ikon där → *Stäng*, eller stäng av *Startförstärkning* / *Fortsätt köra bakgrundsappar* i webbläsarens inställningar.
3. Klicka på **Synka till webbläsare**. Den visar, per webbläsarprofil, vilka bokmärken som skulle tas bort. Bocka för profilerna och klicka på **Ta bort från valda webbläsare**.

*Synka till webbläsare* **tar bara bort** bokmärken; den lägger aldrig till några i en webbläsare. Använd **Exportera** och importera `bookmarks.html` i webbläsaren för att få in bokmärken från biblioteket där.

En säkerhetskopia av varje fil sparas bredvid den, med namnet `Bookmarks.bookmark-syncer-backup-<datum>` (Chromium-baserade webbläsare) eller `places.sqlite.bookmark-syncer-backup-<datum>` (Firefox-baserade). För att ångra: stäng webbläsaren, öppna **Synka till webbläsare → Återställ från säkerhetskopia…** och klicka på **Återställ** vid den säkerhetskopia du vill ha. Filen den ersätter säkerhetskopieras också, så du kan byta tillbaka.

**Om webbläsarnas synk-konton**

- **Firefox Sync** (även i Zen, Floorp och Waterfox): borttagningarna registreras på samma sätt som Firefox själv gör, så de bör nå dina andra enheter.
- **Chrome / Edge / Brave / Vivaldi / Opera / Comet med synk påslagen**: de här webbläsarna räknar inte med att filen ändras medan de är stängda, och synkservern lägger tillbaka bokmärkena. Använd **webbläsartillägget** (nästa avsnitt) för dem. Synkdialogen markerar sådana profiler och lämnar dem obockade.

## 7. Webbläsartillägget

Tillägget **Bookmark syncer helper** tar bort bokmärken genom webbläsaren själv, så att webbläsarens egen synk tar bort dem på alla dina enheter. Det fungerar medan webbläsaren är öppen, så du behöver inte stänga något. Det finns inte i någon tilläggsbutik; du läser in det från din egen kopia.

I appen, klicka på **Synka till webbläsare → Ställ in webbläsartillägget…** och låt det fönstret vara öppet. Där finns mapparna och parkopplingskoden.

Det är testat i Chrome, Edge, Brave, Vivaldi, Opera och Firefox. Comet (Chromium-baserad) och Zen, Floorp och Waterfox (Firefox-baserade) bör fungera på samma sätt, men är inte testade. DuckDuckGo för Windows stöder inte tillägg.

### Chrome, Edge, Brave, Vivaldi, Opera

1. Öppna `chrome://extensions` (Chrome, Brave, Vivaldi), `edge://extensions` (Edge) eller `opera://extensions` (Opera).
2. Slå på **Utvecklarläge** (uppe till höger i Chrome, i panelen till vänster i Edge).
3. Klicka på **Läs in okomprimerat** och välj mappen `extension` som appen visar (knappen **Öppna mappen** öppnar den). Från källkoden ligger den i projektet; i den installerade appen är det `resources\app.asar.unpacked\extension` i installationsmappen.
4. Fäst det: klicka på pusselbitsikonen i verktygsfältet och sedan på nålen vid *Bookmark syncer helper*.
5. Klicka på tilläggets ikon, klistra in **parkopplingskoden** från appen och klicka på **Anslut**.

### Firefox

Det här är valfritt: *Synka till webbläsare* fungerar redan med Firefox Sync. Tillägget besparar dig bara att stänga Firefox.

Appen förbereder en Firefox-version av tillägget i `%APPDATA%\Bookmark syncer\firefox-extension\` (byggs om varje gång du öppnar inställningsfönstret, så den alltid passar appen).

1. Öppna `about:debugging#/runtime/this-firefox`.
2. Klicka på **Läs in tillfälligt tillägg…**. I filfönstret, klistra in sökvägen från appens knapp **Kopiera** (den slutar på `firefox-extension\manifest.json`) i rutan *Filnamn* och tryck Enter. Använd den här mappen, inte projektets mapp `extension`.
3. Fäst det: klicka på pusselbitsikonen, sedan kugghjulet vid *Bookmark syncer helper* → *Fäst i verktygsfältet*.
4. Klicka på ikonen. Första gången, klicka på **Tillåt** så att det får prata med appen på den här datorn, och klistra sedan in parkopplingskoden.

### Firefox: behåll tillägget installerat

Firefox tar bort ett tillfälligt tillägg när det stängs, och vanliga Firefox installerar bara tillägg som Mozilla har signerat. Du kan få det signerat **privat** gratis. Det publiceras eller listas ingenstans:

1. Logga in på (eller skapa) ett gratis konto på [addons.mozilla.org](https://addons.mozilla.org/developers/).
2. Gör en zip: öppna mappen `firefox-extension`, markera **alla filer i den**, högerklicka → *Skicka till* → *Komprimerad (zippad) mapp*. Zippa filerna, inte mappen.
3. I Developer Hub, klicka på **Submit a New Add-on**, välj **On your own** (egen distribution) och ladda upp zip-filen.
4. Den automatiska kontrollen tar oftast några minuter. Ladda sedan ner den signerade `.xpi`-filen.
5. Dra `.xpi`-filen till ett Firefox-fönster, eller öppna `about:addons` → kugghjulet → *Installera tillägg från fil…*.

Efter en uppdatering som ändrar tillägget går dess versionsnummer upp; signera den nya versionen på samma sätt. Från kommandoraden gör `npx web-ext sign --channel=unlisted --source-dir "%APPDATA%\Bookmark syncer\firefox-extension" --api-key <nyckel> --api-secret <hemlighet>` steg 2–4 (nycklar från Developer Hub under *Manage API Keys*).

Firefox Developer Edition och Nightly kan också installera osignerade tillägg: sätt `xpinstall.signatures.required` till `false` i `about:config` och installera sedan zip-filen från steg 2 (omdöpt till `.xpi`).

**Använda det**

1. Ta bort bokmärken i appen som vanligt.
2. Med appen öppen, klicka på tilläggets ikon i webbläsaren. Den visar bokmärkena i den här webbläsaren som du har tagit bort i appen.
3. Klicka på **Ta bort dem i den här webbläsaren**. Appen visar ett meddelande när det är klart.
4. Ångrat dig? Klicka på **Ångra** i tillägget för att lägga tillbaka den senaste omgången i samma mappar och positioner. För att behålla dem för gott, återställ dem också under *Nyligen borttagna* i appen.

**Den öppna sidan: kategori, taggar och anteckningar**

Klicka på tilläggets ikon på en webbsida. Överst i rutan syns om sidan finns i biblioteket, med kategori, taggar, anteckningar och *Läs senare*. Ändra dem och klicka på **Spara ändringar**, eller **Spara i biblioteket** för att lägga till en sida som inte finns där (den får källan *Added from Chrome*, *Added from Firefox* och så vidare). Appen måste vara öppen. Tillägget läser flikens adress och titel bara när du klickar på ikonen (webbläsarens behörighet `activeTab`).

**Sortera i mappar efter kategori**

1. Kategorisera bokmärkena i appen.
2. Med appen öppen, klicka på tilläggets ikon och sedan **Sortera i mappar efter kategori…**. Den visar hur många bokmärken som hamnar i vilken mapp.
3. Klicka på **Sortera dem**. De flyttas till *Andra bokmärken* (*Andra favoriter* i Edge) **→ Bookmark syncer → kategori → underkategori**. Webbläsarens synk flyttar dem på dina andra enheter också.
4. **Ångra sorteringen** flyttar tillbaka varje bokmärke till sin gamla mapp och position och tar bort mapparna den skapade (om de är tomma).

**Ta bort mappar som blir tomma** (en kryssruta under knappen, på som standard, valet sparas) tar också bort de gamla mappar som blir tomma efter sorteringen, och deras överordnade mappar om de också blir tomma. Webbläsarens egna mappar (*Bokmärkesfältet*, *Andra bokmärken*, …) tas aldrig bort, och inte heller en mapp som har något kvar i sig. Ångra återskapar de borttagna mapparna på sina gamla platser och flyttar tillbaka bokmärkena till dem.

Bokmärken flyttas bara, de tas aldrig bort. Kör igen när du har kategoriserat fler; bokmärken som redan ligger i rätt mapp lämnas i fred.

**Så håller det sig privat och säkert**

- Appen lyssnar bara på `127.0.0.1` (port 47615, bara den här datorn) och bara medan den är öppen.
- Den svarar bara tillägget, och bara med rätt parkopplingskod. Webbsidor kan inte läsa din lista över borttagna bokmärken. Klicka på **Ny kod** i appen för att koppla bort alla parkopplade webbläsare.
- Tillägget skickar aldrig dina bokmärken någonstans. Det läser listan över borttagna adresser från appen och rapporterar hur många det tog bort; för den öppna sidan skickar det sidans adress, titel och det du skrev till appen på den här datorn.
- Chrome kan visa ett meddelande om att inaktivera tillägg i utvecklarläge vid start. Klicka på × för att behålla det.
- Firefox: tillägget pratar med appen först efter att du klickat på **Tillåt** i det.

**Uppdatera tillägget**: efter `git pull`, öppna tilläggssidan och klicka på ikonen för att läsa in *Bookmark syncer helper* igen. I Firefox, öppna appens inställningsfönster för tillägget (så att Firefox-versionen byggs om) och klicka sedan på **Ladda om** i `about:debugging`, eller signera och installera den nya versionen.

## 8. En startsida för webbläsaren

⚙ Inställningar → *Startsida* → bocka för **Håll en startsida med mina bokmärken per kategori, för webbläsaren**. Appen skriver `start.html` i sin datamapp: dina favoriter, Läs senare och alla kategorier som kort (mest besökta först; långa fälls ihop bakom *Visa alla*), med en sökruta överst. <kbd>Enter</kbd> öppnar första träffen, <kbd>/</kbd> hoppar till sökrutan. Den följer Windows ljusa eller mörka läge och appens språk.

Appen skriver om den några sekunder efter att biblioteket ändrats, och när den startar. Döda länkar tas inte med. Sidan är en fil på datorn och hämtar ingenting från webben (inte ens webbplatsikoner).

För att se den när webbläsaren startar, klicka på **Kopiera adressen** och klistra in den i webbläsaren:

- **Chrome, Edge, Brave, Vivaldi, Opera:** Inställningar → *Vid start* → *Öppna en viss sida eller en uppsättning sidor* → lägg till adressen. Att slå på Hem-knappen och ge den samma adress fungerar också.
- **Firefox, Zen, Floorp, Waterfox:** Inställningar → *Startsida* → *Startsida och nya fönster* → *Anpassade webbadresser…* → klistra in adressen.

Webbläsare låter inte en fil vara sidan för *ny flik* utan ett tillägg, så det blir bara start- och hemsida. Bockar du ur inställningen slutar den uppdateras; filen finns kvar tills du tar bort den.

## 9. Sök var du än är, och meddelandefältet

Tryck <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> i vilket program som helst för att få fram appen med sökrutan redo. Skriv, sedan öppnar <kbd>Enter</kbd> första träffen.

- När du stänger fönstret fortsätter appen köras i meddelandefältet (ikonen nära klockan), så kortkommandot fortsätter fungera. Högerklicka på ikonen → **Avsluta** för att stänga den på riktigt.
- I ⚙ Inställningar → *Kortkommando och meddelandefält* kan du byta tangenter (klicka i fältet och tryck de nya tangenterna), stänga av kortkommandot, välja om fönstret ska stängas till meddelandefältet och slå på **Starta med Windows**.
- Om ett annat program redan använder tangenterna säger inställningarna det. Välj andra tangenter.

## Felsökning

| Problem | Lösning |
|---|---|
| En inställning eller knapp du väntar dig saknas | Du kör en äldre kopia. Stäng **alla** appens fönster och kör `npm start` igen. |
| `Ollama is not running` | Starta Ollama-appen (den ligger i meddelandefältet), eller installera den. |
| `Ollama har inte modellen …` | Kör `ollama pull <modellnamn>`. |
| Ollama-fel 500 / `llama-server process has terminated` / `CUDA error` | Ditt grafikkort eller din drivrutin fungerar inte med den här Ollama-versionen. Appen byter automatiskt till processorn, försöker igen och kommer ihåg det (⚙ Inställningar → *Kör bara på processorn*). Efter en uppdatering av drivrutinen kan du bocka ur den för att prova grafikkortet igen. |
| `ollama` känns inte igen i PowerShell | Öppna ett nytt PowerShell-fönster efter installationen, eller kör `"$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"`. |
| Claude: `credit balance is too low` | Fyll på krediter i Anthropic Console, eller använd Inbyggda regler eller Ollama. |
| `handshake failed … SSL error` i terminalen | Ofarligt. En webbplats certifikat misslyckades vid hämtning av ikon eller länkkontroll. |
| Electron avslutas med `FATAL` direkt | Flytta projektet till en mapp i din användarprofil och kör `npm start` där. |
| Firefox: filen är låst | Stäng Firefox och importera igen. |
| Synk: "… körs" fast fönstret är stängt | Webbläsaren kör fortfarande i bakgrunden. Stäng den från meddelandefältet, eller avsluta den i Aktivitetshanteraren. |
| Synk: "… stängdes inte av ordentligt" (Firefox, Zen, Floorp, Waterfox) | Öppna webbläsaren, stäng den som vanligt och försök igen. |
| En webbläsare jag använder finns inte i importlistan | Den är inte installerad på det vanliga stället, eller så är det DuckDuckGo (se [4. Importera dina bokmärken](#4-importera-dina-bokmärken)). Exportera en `bookmarks.html` från den och importera den. |
| Store-versionen: *Starta med Windows* saknas i inställningarna | Det är väntat. Slå på det i Windows Inställningar → Appar → Autostart. |
| Store-versionen öppnar sitt fönster vid inloggning i stället för meddelandefältet | Windows tog mer än 3 minuter på sig att starta appen (en långsam inloggning). Stäng fönstret; appen fortsätter köras i meddelandefältet. |
| DuckDuckGo: ingen bokmärkesexport hittades | Exporten måste ligga i Hämtade filer och vara mindre än 7 dagar gammal. Eller använd **Importera en bookmarks.html-fil…** och välj den. |
| Startsidan är gammal | Den skrivs om när biblioteket ändras och när appen startar, så den kan inte uppdateras medan appen är stängd. Kontrollera att ⚙ Inställningar → *Startsida* är förbockad. |
| Bokmärken kom tillbaka efter synk (Chrome/Edge) | Webbläsarens synk återställer ändringar i filen. Använd webbläsartillägget (avsnitt 7). |
| Tillägget: "Bookmark syncer är inte igång" | Öppna appen och klicka sedan på **Försök igen**. Om appens tilläggsfönster säger att porten används är appen förmodligen öppen två gånger. |
| Kortkommandot gör ingenting | Ett annat program har samma tangenter. ⚙ Inställningar visar det; välj andra tangenter. |
| Appen verkar borta efter att jag stängt den | Den ligger i meddelandefältet (nära klockan, kanske under pilen ^). Stäng av *När fönstret stängs fortsätter appen köras i meddelandefältet* om du hellre vill det. |
| Tillägget: "Koden stämmer inte" | Kopiera koden igen från appen (den ändras om du klickar på **Ny kod**). |

## Uppdatera

**Installerad app:** kör det nya installationsprogrammet; det ersätter den gamla versionen och behåller biblioteket. Läs sedan in webbläsartillägget igen (se ovan).

Appen säger till när det finns en ny version: en gång om dagen frågar den GitHub efter den senaste versionen, och om den är nyare än din visar den ett meddelande med en länk **Ladda ner** (också i meddelandefältet), en gång per version. Den laddar aldrig ner eller installerar något själv. ⚙ Inställningar → *Uppdateringar* stänger av det, och **Kontrollera nu** frågar direkt. Nya versioner finns alltid på [sidan Releases](https://github.com/b0red/Bookmark-synker/releases).

**Microsoft Store-versionen:** Store uppdaterar den. Läs in webbläsartillägget igen efteråt om tillägget har ändrats.

**Från källkoden:**

```powershell
git pull
npm install
npm start
```

Biblioteket ligger i `%APPDATA%\Bookmark syncer\` och påverkas inte av uppdateringar.

## Avinstallera

Om du har slagit på *Starta med Windows*, stäng av det i ⚙ Inställningar först och avsluta sedan appen (ikonen i meddelandefältet → Avsluta).

- **Installerad app:** Windows Inställningar → Appar → *Bookmark syncer* (eller *bookmarker* för Store-versionen) → Avinstallera. Biblioteket ligger kvar i `%APPDATA%\Bookmark syncer\`; ta bort den mappen också för att ta bort allt.
- **Från källkoden:** ta bort projektmappen och `%APPDATA%\Bookmark syncer\`.
