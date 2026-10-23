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

**Meghívottak eseményenként**
- Alapértelmezésben a kiválasztott kórus(ok) minden tagja meg van hívva. Az eseménynél választható a *„Csak a kijelölt tagok”* lehetőség is: ilyenkor a tagok **szólamonként csoportosítva** jelennek meg (Szoprán → Alt → Tenor → Basszus, egész szólam egy kattintással kijelölhető), és a meghívotti lista másik eseményről (pl. a főpróbáról) át is másolható.
- Az eseményt a kórus minden tagja látja, de értesítést, emlékeztetőt csak a meghívottak kapnak, és csak ők jelezhetnek vissza. A riportban is csak ők szerepelnek.
- Aki közzététel után kikerül a meghívottak közül, ezt az üzenetet kapja (appban, push-ként és e-mailben): *„Kedves Kórustag!, A megbeszéltek szerint most erre az eseményre mégsem kell jönnöd!”*. A visszajelzése törlődik. Akit közzététel után vesznek fel a listára, megkapja az eseményről szóló értesítést.
- A koncert–főpróba szabály csak azokra vonatkozik, akik a főpróbára is meg vannak hívva.
- **Közel lakók előre:** ha a tagoknál meg van adva az irányítószám és a lakóhely (település), a meghívottak kijelölésekor a szólamokon belül azok kerülnek előre, akik az esemény helyszínéhez (cím + város) légvonalban a legközelebb laknak. A nevük mellett a távolság is látszik (pl. „~5 km”). Akinél nincs lakóhely megadva, az a szólam végére kerül.
  - A koordinátákat az app az **OpenStreetMap** ingyenes szolgáltatásával keresi meg a háttérben. Ehhez csak az irányítószám és a település kerül át, pontos utcacímet nem kérünk és nem küldünk. A találatokat eltárolja, így minden településre csak egyszer kérdez rá. A szolgáltatás szabályai szerint másodpercenként legfeljebb egy keresést indít, ezért egy nagy tagimport után a koordináták néhány perc alatt töltődnek fel.
  - Kikapcsolható a `GEOCODING=off` beállítással.

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
- `tagok_import_sablon.xlsx` / `.csv`. Oszlopok: Vezetéknév, Keresztnév, E-mail, Telefon, Szólam, Irányítószám, Lakóhely (település), Cantemus Vegyeskar (igen/nem), Pro Musica (igen/nem), Admin (igen/nem).
- `esemenyek_import_sablon.xlsx` / `.csv`. Oszlopok: Esemény neve, Dátum, Kezdés, Befejezés, Típus, Énekkar, Turné, Ország, Város, Cím, Épület, Visszajelzési határidő, Megjegyzés.

Az Excel-sablonok második munkalapján kitöltési útmutató található.

**Duplikáció elleni védelem:**
- **Tagok:** a tagot az e-mail-címe azonosítja. Újraimportáláskor a meglévő tagok adatai frissülnek, nem jönnek létre újra. Ha egy cím a táblázaton belül kétszer szerepel, a második sor kimarad, és erről hibaüzenet jelenik meg (ilyenkor az „inaktiválás” opció sem fut le).
- **Események táblázatból:** ha már létezik azonos nevű esemény (kis- és nagybetű, szóközök nem számítanak) ugyanazon a napon, ugyanabban a kezdési időpontban, közös kórussal, a sor kimarad. Ugyanez vonatkozik a táblázaton belüli ismétlődésekre is.
- **Google Naptár:** minden naptárbejegyzés (ismétlődőnél minden alkalom) azonosítóval kerül be, így az import nyugodtan többször is futtatható. A naptárban azóta áthelyezett vagy átnevezett eseményeket frissíti, és a közzétett eseményeknél a tagok „Módosult” értesítést kapnak. A határidő ugyanannyi nappal tolódik, mint az esemény. Az appban kézzel módosított mezőket (pl. épület, típus) csak akkor írja felül, ha a naptárban is változtak. Ha egy esemény kézzel vagy táblázatból már fel volt véve, nem duplikálja, hanem összekapcsolja a naptárral.
- **Naptárból törölt események:** újraimportáláskor az app felismeri azokat az eseményeket, amelyek ugyanabból a naptárból (a naptár neve alapján) és az import időszakából származnak, de a naptárból azóta törölték vagy ott lemondták őket. Ezekkel magától nem tesz semmit, hanem felajánlja őket: a kijelölt piszkozatokat törli, a kijelölt közzétett eseményeket lemondja (a tagok értesítést kapnak), a többit megtartja és leválasztja a naptárról. Egy ismétlődő próba egyetlen lemondott alkalmát már az első importnál sem hozza létre.

## Üzembe helyezés

> **Railway-re telepítés lépésről lépésre: [RAILWAY.md](RAILWAY.md)**

Más tárhelyen: egy állandóan futó szerver kell Node.js 22.13+ verzióval (vagy Dockerrel), egy domain HTTPS-sel (a push értesítésekhez kötelező), valamint e-mail-küldés (SMTP, vagy Brevo/Resend API).

1. **Beállítások:** másold a `.env.example` fájlt `.env` néven, és töltsd ki:
   - `APP_URL`: az app címe, pl. `https://korus.cantemus.hu`
   - `ADMIN_EMAILS`: kik legyenek adminok (ezekkel a címekkel lehet először belépni)
   - e-mail: vagy `SMTP_*` (a levelezőszerver adatai), vagy `EMAIL_PROVIDER=brevo|resend` + `EMAIL_API_KEY` (ahol az SMTP le van tiltva, pl. a Railway Hobby csomagján)
   - `VAPID_*` (nem kötelező): ha nincs megadva, az app első induláskor generál egy kulcspárt, és az adatbázisban tárolja
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
npm run seed       # demóadatok (admin@example.com, tag1…tag10@example.com)
npm run dev        # szerver: http://localhost:3000 (API)
npm run dev:client # felület: http://localhost:5173
npm test           # automatikus tesztek
npm run templates  # import sablonok újragenerálása
```

SMTP nélkül az e-mailek nem mennek ki, csak a szerver konzoljára kerülnek. Ilyenkor a belépési kód a belépési képernyőn is megjelenik (csak fejlesztői módban, `NODE_ENV=production` mellett soha).

**Felépítés:** `server/` (Express + beépített SQLite, ütemező, e-mail, push, import/export), `client/` (React felület, service worker), `shared/` (közös szövegek és konstansok), `templates/` (import sablonok), `test/` (tesztek).
