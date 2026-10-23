// Push értesítésekhez szükséges VAPID kulcspár: npm run vapid – az eredményt másold a .env fájlba.
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
