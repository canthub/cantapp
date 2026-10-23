# Telepítés a Railway-re – lépésről lépésre

Az útmutató végén az app a saját címén (pl. `https://korus.cantemus.hu`) fut, e-mailt küld, push értesítést ad, és a GitHubra feltöltött minden változás után magától frissül.

> A Railway és a Brevo felülete időnként változik. Ha egy menüpont neve nem pontosan egyezik, keresd a hasonló nevűt.

**Amire szükség lesz:**
- egy bankkártya (Railway Hobby csomag, kb. havi 5 USD);
- hozzáférés a `cantemus.hu` domain DNS-beállításaihoz, vagy valaki, aki ezt kezeli (két bejegyzést kell majd felvenni);
- kb. 30–45 perc.

---

## 1. E-mail-küldés előkészítése (Brevo)

A Railway Hobby csomagján a hagyományos e-mail-küldés (SMTP) le van tiltva, ezért az app a **Brevo** levelezőszolgáltatáson keresztül küld. A Brevo EU-s (francia) szolgáltató.

1. Regisztrálj a <https://www.brevo.com> oldalon. Az ingyenes csomag napi néhány száz levelet enged; ha a kórus forgalma ezt meghaladja, kisebb fizetős csomagra lehet váltani.
2. **Hitelesítsd a feladó domaint**, különben a levelek a spam mappába kerülhetnek, vagy el sem mennek:
   *Beállítások (fogaskerék) → Senders, Domains & Dedicated IPs → Domains → Add a domain* → `cantemus.hu`.
   A Brevo kiír néhány DNS-bejegyzést (TXT, DKIM, DMARC). Ezeket kell felvenni a `cantemus.hu` DNS-beállításai közé, majd a Brevóban az *Authenticate* gombra kattintani.
3. **Hozz létre API-kulcsot:** *SMTP & API → API Keys → Generate a new API key*. A kulcs `xkeysib-…` kezdetű. Másold ki, a 3. lépésben kell.

## 2. A projekt létrehozása a Railway-en

1. Nyisd meg a <https://railway.com> oldalt, és lépj be **GitHub-fiókkal**. A legegyszerűbb a `canthub` fiókkal belépni, mert az a repó tulajdonosa.
2. Fizess elő a **Hobby** csomagra (*profilkép → Account Settings → Plans*).
3. Kattints a **New Project → Deploy from GitHub repo** gombra.
   - Ha a listában nem látszik a `cantapp`, kattints a *Configure GitHub App* lehetőségre, és adj hozzáférést a `canthub/cantapp` repóhoz.
   - Válaszd ki a **cantapp** repót. A Railway megtalálja a `Dockerfile`-t, és elkezdi az építést. Az első indítás még hiányos beállításokkal fut, ez nem baj.
4. **Régió:** kattints a szolgáltatásra (a `cantapp` kártyára) → *Settings → Deploy → Regions* → válaszd az **EU West (Amsterdam)** régiót. Így a tagok adatai az EU-ban maradnak.
5. **Tartós tároló az adatbázisnak (fontos!):** a projekt felületén *+ Create* (vagy jobb klikk az üres területen) *→ Volume*. Csatold a `cantapp` szolgáltatáshoz, a **Mount path** legyen pontosan: `/data`.
   Tároló nélkül minden újraindításkor elvesznének az adatok!
6. Ellenőrizd, hogy a *Settings* oldalon az **App Sleeping / Serverless** kikapcsolt állapotban van. Ha be lenne kapcsolva, az app „elaludna”, és nem mennének ki az emlékeztetők.

## 3. Beállítások (környezeti változók)

A szolgáltatásnál nyisd meg a *Variables → Raw Editor* nézetet, másold be az alábbiakat, és írd át a saját értékeitekre:

```
APP_URL=https://korus.cantemus.hu
ADMIN_EMAILS=korusasszisztens@cantemus.hu,support@cantemus.hu
EMAIL_PROVIDER=brevo
EMAIL_API_KEY=xkeysib-ide-jon-a-brevo-kulcs
EMAIL_FROM=Cantemus Kórus <noreply@cantemus.hu>
GEOCODER_CONTACT=support@cantemus.hu
```

| Változó | Mire való |
|---|---|
| `APP_URL` | Az app címe. Ez kerül az e-mailekben lévő linkekbe. Amíg nincs saját domain, a Railway által adott címet írd ide (lásd a 4. lépést). |
| `ADMIN_EMAILS` | Ezek a címek mindig adminok. Velük lehet először belépni és a tagokat importálni. |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY` | A Brevo-kulcs az 1. lépésből. |
| `EMAIL_FROM` | A feladó. A domainjének (`cantemus.hu`) hitelesítve kell lennie a Brevóban. |
| `GEOCODER_CONTACT` | Elérhetőség az OpenStreetMap felé (a „közel lakók” funkcióhoz kötelező megadni). |

Mentés után a Railway magától újraindítja az appot.

**Ezeket nem kell megadni:**
- a portot és az adatbázis helyét az app és a Railway magától kezeli;
- a push értesítések kulcsait az app első induláskor magától legenerálja, és a tárolóban megőrzi.

## 4. Cím (domain)

1. A szolgáltatásnál *Settings → Networking*:
   - **Gyors kezdéshez:** *Generate Domain*. Kapsz egy `…up.railway.app` címet. Ezt írd be az `APP_URL` változóba.
   - **Saját címhez:** *Custom Domain* → `korus.cantemus.hu`. A Railway kiír egy **CNAME** bejegyzést (és esetleg egy TXT-t). Ezeket kell felvenni a `cantemus.hu` DNS-beállításai közé. Pár perc vagy néhány óra után a cím él, és a HTTPS-tanúsítványt a Railway automatikusan intézi.
2. Ha saját címre váltottál, írd át az `APP_URL` változót is.

## 5. Ellenőrzés

1. *Deployments →* a legutóbbi indítás → *View logs*. Ezt kell látnod: `Cantemus Kórus app fut: https://…`. Ha ott „Nincs e-mail-küldés beállítva” figyelmeztetés áll, a 3. lépés valamelyik értéke hiányzik.
2. Nyisd meg az app címét, és lépj be az egyik `ADMIN_EMAILS` címmel. A belépési kód e-mailben érkezik.
3. *Admin → Beállítások → Teszt e-mail magamnak*: megérkezik a levél?
4. *Profil → Értesítések bekapcsolása*, majd *Admin → Beállítások → Teszt push*: megjelenik az értesítés a telefonon?

## 6. Indulás

1. *Admin → Tagok → Importálás táblázatból*: töltsd le a sablont, töltsd ki, és töltsd fel.
2. Hozd létre vagy importáld az eseményeket (táblázatból vagy Google Naptárból), majd tedd közzé őket.
3. Küldd ki a tagoknak az app címét és a telepítési útmutatót (`README.md` → *Tagok telepítési útmutatója*).

## Karbantartás

- **Frissítés:** a `main` ágra kerülő minden változás után a Railway magától újraépíti és elindítja az appot. Az adatok a tárolóban megmaradnak.
- **Adatmentés:** havonta egyszer: *Admin → Beállítások → Teljes adatmentés letöltése*, és a fájlt tedd biztonságos helyre (pl. Google Drive).
- **Költség:** a Railway felületén (*Usage*) követhető, mennyit fogyaszt az app.
- **Ne indíts több példányt** (*Replicas*): az adatbázis egyetlen példányhoz készült.
