import { CHOIRS, article, missedMessage, THANK_YOU_MESSAGE, UNINVITED_MESSAGE } from '../../shared/constants.js';
import { formatDateHu, formatIsoHu } from './time.js';
import { esc } from './mailer.js';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const eventUrl = (ev) => `/#/esemeny/${ev.id}`;

function when(ev) {
  const time = ev.startTime ? `${ev.startTime}${ev.endTime ? `–${ev.endTime}` : ''}` : '';
  return formatDateHu(ev.date, time);
}

function place(ev) {
  return [ev.venue, ev.address, ev.city, ev.country].filter(Boolean).join(', ');
}

function details(ev) {
  const rows = [
    ['Esemény', ev.name],
    ['Típus', ev.typeLabel + (ev.isTour ? ' (koncertturné)' : '')],
    ['Énekkar', ev.choirs.map((c) => CHOIRS[c]).join(', ')],
    ['Időpont', when(ev)],
    ['Helyszín', place(ev) || '–'],
    ['Visszajelzési határidő', formatIsoHu(ev.deadlineAt)],
  ];
  if (ev.notes) rows.push(['Megjegyzés', ev.notes]);
  const tr = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#8a817a;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('');
  const map = ev.mapsUrl ? `<p style="margin:12px 0 0"><a href="${esc(ev.mapsUrl)}" style="color:#7a1f2b">📍 Megnyitás a Google Térképen</a></p>` : '';
  return `<table role="presentation" style="border-collapse:collapse;font-size:14px;margin-top:8px">${tr}</table>${map}`;
}

export function announceMessage(ev) {
  return {
    kind: 'announce',
    title: `Új esemény: ${ev.name}`,
    body: `${ev.typeLabel}${ev.isTour ? ' (koncertturné)' : ''} – ${when(ev)}${place(ev) ? `, ${place(ev)}` : ''}. Kérjük, jelezz vissza eddig: ${formatIsoHu(ev.deadlineAt)}.`,
    url: eventUrl(ev),
    emailHtml: details(ev),
  };
}

export function reminderMessage(ev, kind = 'weekly') {
  return {
    kind,
    title: `Emlékeztető: ${ev.name}`,
    body: `Még nem jeleztél vissza ${article(ev.name)} ${ev.name} eseményre (${when(ev)}). Határidő: ${formatIsoHu(ev.deadlineAt)}.`,
    url: eventUrl(ev),
    emailHtml: details(ev),
  };
}

export function generalReminderMessage(ev) {
  return {
    kind: 'manual',
    title: `Emlékeztető: ${ev.name}`,
    body: `Emlékeztetünk ${article(ev.name)} ${ev.name} eseményre: ${when(ev)}${place(ev) ? `, ${place(ev)}` : ''}.`,
    url: eventUrl(ev),
    emailHtml: details(ev),
  };
}

export function changeMessage(ev) {
  return {
    kind: 'change',
    title: `Módosult: ${ev.name}`,
    body: `Megváltoztak ${article(ev.name)} ${ev.name} esemény adatai. Új időpont: ${when(ev)}${place(ev) ? `, helyszín: ${place(ev)}` : ''}.`,
    url: eventUrl(ev),
    emailHtml: details(ev),
  };
}

export function cancelMessage(ev) {
  return {
    kind: 'cancel',
    title: `Elmarad: ${ev.name}`,
    body: `${cap(article(ev.name))} ${ev.name} (${when(ev)}) elmarad.`,
    url: eventUrl(ev),
    emailHtml: '',
  };
}

export function missedEventMessage(ev) {
  return {
    kind: 'missed',
    title: `Lejárt a visszajelzési határidő: ${ev.name}`,
    body: missedMessage(ev.name),
    url: eventUrl(ev),
    emailHtml: '',
  };
}

export function uninvitedMessage(ev) {
  return {
    kind: 'uninvited',
    title: `Változás: ${ev.name}`,
    body: UNINVITED_MESSAGE,
    url: eventUrl(ev),
    // A szöveg maga a megszólítással kezdődik, ezért az e-mailbe nem teszünk külön „Kedves …!” sort.
    greeting: false,
    emailHtml: details(ev),
  };
}

export function thanksMessage(ev) {
  return {
    kind: 'thanks',
    title: THANK_YOU_MESSAGE,
    body: `Visszajelzésedet rögzítettük ${article(ev.name)} ${ev.name} eseményre.`,
    url: eventUrl(ev),
    email: false,
  };
}

export function concertResponseRemovedMessage(concert, dr) {
  return {
    kind: 'rule',
    title: `Visszajelzés törölve: ${concert.name}`,
    body: `Mivel ${article(dr.name)} ${dr.name} főpróbára nem jeleztél részvételt, ${article(concert.name)} ${concert.name} koncertre adott visszajelzésedet töröltük. Ha mégis ott leszel a főpróbán, jelezz újra mindkettőre!`,
    url: eventUrl(concert),
    email: false,
  };
}
