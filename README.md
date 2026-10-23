# Cantemus Kórus app

Telefonon használható alkalmazás a **Cantemus Vegyeskar** és a **Pro Musica** énekkar aktív tagjainak: események (próba, főpróba, koncert, utazás) közzététele, értesítések és visszajelzések gyűjtése, automatikus emlékeztetők és riportok.

Az app egy **telepíthető webalkalmazás (PWA)**: a telefon böngészőjében megnyitva a kezdőképernyőre tehető, onnan appként indul, és push értesítéseket is kap. Nem kell App Store-ba vagy Google Play-be feltölteni.

## Mit tud?

**Tagoknak**
- Bejelentkezés e-mail-címmel és egy 6 jegyű kóddal (jelszó nélkül).
- Csak a saját énekkaruk eseményeit látják. Akik mindkét kórusnak tagjai, mindkettőét látják.
- Esemény adatai: dátum, időpont, név, helyszín (ország, város, cím, épület), **„Megnyitás Google Térképen”** gomb, típus, énekkar, koncertturné jelölés.
- Visszajelzés: *Részt veszek / Talán / Nem tudok részt venni*. A válasz a határidőig módosítható.
- **Koncertre csak az jelölhet részvételt, aki a hozzá tartozó főpróbára is jelölt.** Ha valaki később a főpróbát „nem”-re állítja, a koncertre adott „igen”/„talán” válasza törlődik, és erről üzenetet kap.
- Visszajelzéskor üzenet: *„Köszönjük, hogy visszajeleztél nekünk! 🙂”*.
- A határidő után az esemény lezárul: látható marad, de már nem jelölhető.

**Automatikus értesítések** (az appban, push értesítésként a telefonon és e-mailben):

| Mikor | Kinek | Mit |
|---|---|---|
| Közzétételkor | az érintett kórus(ok) tagjainak | „Új esemény: …” |
| Hetente egyszer (reggel 9-től) | aki még nem jelzett vissza | emlékeztető |
| A határidő előtti utolsó 7 napban naponta | aki még nem jelzett vissza | emlékeztető |
| A határidő lejártakor | aki nem jelzett vissza | „Sajnáljuk, hogy nem tudsz részt venni az (esemény neve) eseményen, reméljük a következőn találkozunk! 🙂 Ne felejts el visszajelezni a határidőig!” |
| A határidőt követő napon 8:00-kor | korusasszisztens@, foldesi.ildiko@, szabo.soma@, support@cantemus.hu | táblázatos riport (Excel + CSV csatolmány) |

**Admin felület**
- Események létrehozása, szerkesztése, közzététele, lemondása és törlése. Változáskor értesítés küldhető.
- **Import táblázatból** (Excel/CSV sablon) és **Google Naptárból** (iCal cím vagy .ics fájl, ismétlődő próbákkal együtt). Az importált események piszkozatként jönnek létre, és egyszerre is közzétehetők.
- **Tagok importja táblázatból** (sablonnal), kézi felvétel és szerkesztés, inaktiválás.
- Eseményenként élő követés: összesítő, szólamonkénti bontás, taglista a válaszokkal. Az admin rögzítheti vagy módosíthatja a tagok válaszát (pl. ha valaki szóban szólt).
- **Gombnyomásra emlékeztető** a vissza nem jelzőknek vagy mindenkinek, saját szöveggel is.
- **Export**: Excel, CSV, nyomtatható nézet (PDF-be is menthető), illetve küldés e-mailben tetszőleges címekre.
- Beállítások: a riport címzettjei, teszt e-mail, teszt push.

## Import sablonok

A `templates/` mappában (és az admin felületen letölthetően):
- `tagok_import_sablon.xlsx` / `.csv`. Oszlopok: Vezetéknév, Keresztnév, E-mail, Telefon, Szólam, Cantemus Vegyeskar (igen/nem), Pro Musica (igen/nem), Admin (igen/nem).
- `esemenyek_import_sablon.xlsx` / `.csv`. Oszlopok: Esemény neve, Dátum, Kezdés, Befejezés, Típus, Énekkar, Turné, Ország, Város, Cím, Épület, Visszajelzési határidő, Megjegyzés.

Az Excel-sablonok második munkalapján kitöltési útmutató található.

**Duplikáció elleni védelem:**
- **Tagok:** a tagot az e-mail-címe azonosítja. Újraimportáláskor a meglévő tagok adatai frissülnek, nem jönnek létre újra. Ha egy cím a táblázaton belül kétszer szerepel, a második sor kimarad, és erről hibaüzenet jelenik meg (ilyenkor az „inaktiválás” opció sem fut le).
- **Események táblázatból:** ha már létezik azonos nevű esemény (kis- és nagybetű, szóközök nem számítanak) ugyanazon a napon, ugyanabban a kezdési időpontban, közös kórussal, a sor kimarad. Ugyanez vonatkozik a táblázaton belüli ismétlődésekre is.
- **Google Naptár:** minden naptárbejegyzés (ismétlődőnél minden alkalom) azonosítóval kerül be, így az import nyugodtan többször is futtatható. A naptárban azóta áthelyezett vagy átnevezett eseményeket frissíti, és a közzétett eseményeknél a tagok „Módosult” értesítést kapnak. A határidő ugyanannyi nappal tolódik, mint az esemény. Az appban kézzel módosított mezőket (pl. épület, típus) csak akkor írja felül, ha a naptárban is változtak. Ha egy esemény kézzel vagy táblázatból már fel volt véve, nem duplikálja, hanem összekapcsolja a naptárral.
- **Naptárból törölt események:** újraimportáláskor az app felismeri azokat az eseményeket, amelyek ugyanabból a naptárból (a naptár neve alapján) és az import időszakából származnak, de a naptárból azóta törölték vagy ott lemondták őket. Ezekkel magától nem tesz semmit, hanem felajánlja őket: a kijelölt piszkozatokat törli, a kijelölt közzétett eseményeket lemondja (a tagok értesítést kapnak), a többit megtartja és leválasztja a naptárról. Egy ismétlődő próba egyetlen lemondott alkalmát már az első importnál sem hozza létre.

## Üzembe helyezés

Szükséges: egy állandóan futó szerver Node.js 22.13+ verzióval (vagy Dockerrel), egy domain HTTPS-sel (a push értesítésekhez kötelező), valamint egy SMTP fiók az e-mailekhez.

1. **Beállítások:** másold a `.env.example` fájlt `.env` néven, és töltsd ki:
   - `APP_URL`: az app címe, pl. `https://korus.cantemus.hu`
   - `ADMIN_EMAILS`: kik legyenek adminok (ezekkel a címekkel lehet először belépni)
   - `SMTP_*`: a levelezőszerver adatai (pl. a cantemus.hu levelezése, vagy egy szolgáltató, mint a Brevo vagy a Mailgun)
   - `VAPID_*`: futtasd az `npm run vapid` parancsot, és másold be a két kulcsot
2. **Indítás Dockerrel:**
   ```bash
   docker build -t cantapp .
   docker run -d --name cantapp --env-file .env -p 3000:3000 -v cantapp-data:/data --restart unless-stopped cantapp
   ```
   **vagy Docker nélkül:**
   ```bash
   npm ci
   npm run build
   npm start
   ```
3. Tegyél elé egy HTTPS-t adó reverse proxyt (pl. Caddy vagy Nginx), vagy használj olyan tárhelyet, amely ezt megoldja (pl. Fly.io, Railway, Render tartós lemezzel).
4. Lépj be adminként, importáld a tagokat, majd hozd létre vagy importáld az eseményeket.

Az adatok egyetlen SQLite-fájlban vannak (`DB_PATH`, Dockerben `/data/cantapp.db`). **Ezt a fájlt rendszeresen menteni kell.**

### Tagok telepítési útmutatója (küldd ki nekik)
- **iPhone:** Safariban nyisd meg az app címét → *Megosztás* (⬆️) → *Főképernyőhöz adás*. Utána a kezdőképernyőről indítsd, és a *Profil* oldalon kapcsold be az értesítéseket. iOS 16.4 vagy újabb szükséges.
- **Android:** Chrome-ban nyisd meg → ⋮ menü → *Telepítés* / *Hozzáadás a kezdőképernyőhöz* → *Profil* → értesítések bekapcsolása.

E-mailt mindenki kap a push értesítésektől függetlenül.

## Fejlesztés

```bash
npm install
npm run seed       # demóadatok (admin@example.com, tag1…tag8@example.com)
npm run dev        # szerver: http://localhost:3000 (API)
npm run dev:client # felület: http://localhost:5173
npm test           # automatikus tesztek
npm run templates  # import sablonok újragenerálása
```

SMTP nélkül az e-mailek nem mennek ki, csak a szerver konzoljára kerülnek. Ilyenkor a belépési kód a belépési képernyőn is megjelenik (csak fejlesztői módban, `NODE_ENV=production` mellett soha).

**Felépítés:** `server/` (Express + beépített SQLite, ütemező, e-mail, push, import/export), `client/` (React felület, service worker), `shared/` (közös szövegek és konstansok), `templates/` (import sablonok), `test/` (tesztek).
