# Telepítés a Renderre – lépésről lépésre

Az útmutató végén az app a saját címén (pl. `https://korus.cantemus.hu`) fut, e-mailt küld, push értesítést ad, és a GitHub `main` ágára kerülő minden változás után magától frissül.

> A Render és a Brevo felülete időnként változik. Ha egy menüpont neve nem pontosan egyezik, keresd a hasonló nevűt.

**Amire szükség lesz:**
- egy bankkártya (a Render *Starter* csomagja és egy 1 GB-os tároló, összesen kb. havi 7–8 USD; a pontos árat a Render árlistáján ellenőrizd);
- hozzáférés a `cantemus.hu` domain DNS-beállításaihoz, vagy valaki, aki ezt kezeli;
- kb. 30–45 perc.

---

## 1. E-mail-küldés előkészítése (Brevo)

Az app a **Brevo** levelezőszolgáltatáson keresztül küld. A Brevo EU-s (francia) szolgáltató, és megbízhatóan kézbesíti a tömeges értesítéseket.

1. Regisztrálj a <https://www.brevo.com> oldalon. Az ingyenes csomag napi néhány száz levelet enged; ha a kórus forgalma ezt meghaladja, kisebb fizetős csomagra lehet váltani.
2. **Hitelesítsd a feladó domaint**, különben a levelek a spam mappába kerülhetnek, vagy el sem mennek:
   *Beállítások (fogaskerék) → Senders, Domains & Dedicated IPs → Domains → Add a domain* → `cantemus.hu`.
   A Brevo kiír néhány DNS-bejegyzést (TXT, DKIM, DMARC). Ezeket kell felvenni a `cantemus.hu` DNS-beállításai közé, majd a Brevóban az *Authenticate* gombra kattintani. Az érvényesülés néhány percig, de akár néhány óráig is tarthat.
3. **Hozz létre API-kulcsot:** *SMTP & API → API Keys → Generate a new API key*. A kulcs `xkeysib-…` kezdetű. Másold ki, a 2. lépésben kell.

> **Brevo nélkül is lehet:** ha a `cantemus.hu`-hoz már van levelezés (pl. Google Workspace vagy a tárhelyszolgáltatóé), az app SMTP-n is küldhet. Ilyenkor a 2. lépésben `EMAIL_PROVIDER` és `EMAIL_API_KEY` helyett ezeket add meg: `SMTP_HOST`, `SMTP_PORT` (általában 587), `SMTP_USER`, `SMTP_PASS`. A Brevót mégis ajánljuk, mert a sok egyszerre kiküldött értesítést egy átlagos levelezőfiók napi korlátja megfoghatja.

## 2. Az app létrehozása a Renderen

1. Nyisd meg a <https://render.com> oldalt, és regisztrálj **GitHub-fiókkal**. A legegyszerűbb a `canthub` fiókkal, mert az a repó tulajdonosa.
2. A *Billing* (számlázás) részben add meg a bankkártyát.
3. Kattints a **New → Blueprint** gombra.
   - Kösd össze a GitHubbal, és adj hozzáférést a `canthub/cantapp` repóhoz.
   - Válaszd ki a **cantapp** repót és a `main` ágat. A Render beolvassa a repóban lévő `render.yaml`-t, ezért magától beállítja:
     - a frankfurti (EU-s) régiót, így a tagok adatai az EU-ban maradnak;
     - a *Starter* csomagot;
     - az 1 GB-os tartós tárolót a `/data` útvonalon (ide kerül az adatbázis);
     - az állapotellenőrzést.
4. A Render elkéri a változók értékeit. Ezeket töltsd ki:

| Változó | Mit írj be |
|---|---|
| `ADMIN_EMAILS` | Kik legyenek adminok, vesszővel elválasztva, pl. `korusasszisztens@cantemus.hu,support@cantemus.hu`. Ezekkel a címekkel lehet először belépni. |
| `EMAIL_API_KEY` | A Brevo-kulcs az 1. lépésből (`xkeysib-…`). |
| `EMAIL_FROM` | A feladó, pl. `Cantemus Kórus <noreply@cantemus.hu>`. A domainnek hitelesítve kell lennie a Brevóban. |
| `GEOCODER_CONTACT` | Egy elérhetőség az OpenStreetMap felé (a „közel lakók” funkcióhoz), pl. `support@cantemus.hu`. |

   Az `EMAIL_PROVIDER` értéke már be van állítva (`brevo`).
5. Kattints az **Apply** (vagy *Deploy Blueprint*) gombra. Az első építés néhány percig tart.

**Ezeket nem kell megadni:**
- a portot és az adatbázis helyét az app és a Render magától kezeli;
- a push értesítések kulcsait az app első induláskor magától legenerálja, és a tárolóban megőrzi;
- az app címét: amíg nincs saját domain, a Render által adott `…onrender.com` címet használja.

## 3. Ellenőrzés

1. A Render felületén nyisd meg a `cantapp` szolgáltatást → *Logs*. Ezt kell látnod: `Cantemus Kórus app fut: https://cantapp-….onrender.com`. Ha ott „Nincs e-mail-küldés beállítva” figyelmeztetés áll, valamelyik változó hiányzik (*Environment* fül).
2. Nyisd meg a felül látható `…onrender.com` címet, és lépj be az egyik `ADMIN_EMAILS` címmel. A belépési kód e-mailben érkezik.
3. *Admin → Beállítások → Teszt e-mail magamnak*: megérkezik a levél?
4. Telefonon: *Profil → Értesítések bekapcsolása*, majd *Admin → Beállítások → Teszt push*: megjelenik az értesítés?

## 4. Saját cím (pl. korus.cantemus.hu)

1. *cantapp → Settings → Custom Domains → Add Custom Domain* → `korus.cantemus.hu`.
2. A Render kiír egy **CNAME** bejegyzést. Ezt kell felvenni a `cantemus.hu` DNS-beállításai közé. Az érvényesülés után a Render a HTTPS-tanúsítványt magától intézi.
3. *Environment* fül → *Add Environment Variable*: `APP_URL` = `https://korus.cantemus.hu`, majd mentés. Ettől kezdve az e-mailekben lévő linkek erre a címre mutatnak.

## 5. Indulás

1. *Admin → Tagok → Importálás táblázatból*: töltsd le a sablont, töltsd ki, és töltsd fel.
2. Hozd létre vagy importáld az eseményeket (táblázatból vagy Google Naptárból), majd tedd közzé őket.
3. Küldd ki a tagoknak az app címét és a telepítési útmutatót (`README.md` → *Tagok telepítési útmutatója*).

## Karbantartás

- **Frissítés:** a `main` ágra kerülő minden változás után a Render magától újraépíti és elindítja az appot. A tároló miatt frissítéskor néhány másodpercig nem érhető el az app; az adatok megmaradnak.
- **Adatmentés:** havonta egyszer: *Admin → Beállítások → Teljes adatmentés letöltése*, és a fájlt tedd biztonságos helyre (pl. Google Drive). A Render a tárolóról is készít napi pillanatképet, de a saját mentés ettől független biztonsági háló.
- **Ne indíts több példányt** (*Scaling*): a tároló és az adatbázis egyetlen példányhoz készült.
- **Ne válts ingyenes csomagra:** az ingyenes szolgáltatás elalszik, és nincs tartós tárolója, így elvesznének az adatok, és nem mennének ki az emlékeztetők.
