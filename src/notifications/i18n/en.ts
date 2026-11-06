/**
 * Guest-facing wording of the e-mails, WhatsApp/SMS texts and the receipt PDF,
 * in English. The other languages (fr.ts, de.ts, ...) hold the same keys with
 * the same {placeholders} (checked by i18n.spec.ts). Activity and package
 * names stay in English everywhere: they are the park's brand names.
 * Plural forms are keys ending in _one, _two, _few, _many and _other (CLDR categories).
 * A few strings carry <strong> markup: they are only used in HTML, with escaped values.
 */
export const en = {
  // the visit
  slot_morning: 'Morning arrival, 09:00 to 12:00',
  slot_afternoon: 'Afternoon arrival, 12:00 to 15:30',
  slotInline_morning: 'morning arrival, 09:00 to 12:00',
  slotInline_afternoon: 'afternoon arrival, 12:00 to 15:30',
  adults_one: '{n} adult', adults_two: '{n} adults', adults_few: '{n} adults', adults_many: '{n} adults', adults_other: '{n} adults',
  kids_one: '{n} child', kids_two: '{n} children', kids_few: '{n} children', kids_many: '{n} children', kids_other: '{n} children',
  infants_one: '{n} under 6', infants_two: '{n} under 6', infants_few: '{n} under 6', infants_many: '{n} under 6', infants_other: '{n} under 6',
  and: ' and ',
  rate_visitor: 'visitor rate',
  rate_resident: 'resident rate',
  rate_residentId: 'resident rate (bring an ID)',
  rate_residentIdShort: 'resident rate, bring an ID',

  // what is owed
  pay_paid: '{total} paid',
  pay_deposit: '{due} deposit due now, {total} in all',
  pay_partial: '{paid} paid, {rest} to pay on arrival',
  pay_onArrival: '{total} to pay on arrival',
  ticketPay_paid: 'Paid: {total}',
  ticketPay_deposit: 'To pay on arrival: {due} deposit due now, {total} in all (cash or card at the gate)',
  ticketPay_partial: 'To pay on arrival: {paid} paid, {rest} (cash or card at the gate)',
  ticketPay_onArrival: 'To pay on arrival: {total} (cash or card at the gate)',

  // waivers
  waiver_byEvening: 'by {date} evening',
  waiver_beforeArrival: 'before you arrive',

  // shared lines
  hiComma: 'Hi {name},',
  reference: 'Reference: {ref}',
  yourTicket: 'Your ticket: {url}',
  directions: 'Directions: {maps}',
  questions: 'Questions? Reply here or call {phone}.',
  bookingQuestions: 'Booking {ref} · questions? Reply here or call {phone}.',
  footerBooking: 'Booking {ref} · {phone} · sales@vallepark.com',
  btn_signWaivers: 'Sign the waivers',
  btn_openTicket: 'Open my ticket',

  // ticket by WhatsApp
  waTicket_hi: 'Hi {name}, your VALLÉ Advenature™ Park booking is confirmed! 🎟️',
  waTicket_qr: 'Your ticket with QR code: {url}',
  waTicket_waiver: 'Sign the safety waiver for everyone in your party {deadline} and skip the paperwork at the gate: {url}',
  waTicket_gate: 'Show it at the gate. Directions: {maps}',

  // ticket by e-mail
  ticket_subject: 'Your VALLÉ ticket {ref} · {date}',
  ticket_booked: 'Your day at VALLÉ Advenature™ Park is booked. Show the QR code (attached, and at the link below) at the gate.',
  ticket_visit: 'Visit: {date}',
  ticket_party: 'Party: {party} · {rate}',
  ticket_total: 'Total: {total} · {pay}',
  ticket_waiver: 'Sign the safety waiver {deadline} (one per person, 2 minutes on your phone, it saves queuing at the gate): {url}',
  ticket_gettingHere: 'Getting here: {address}. {maps}',
  ticket_bring: 'Bring closed shoes, sunscreen, water and a change of clothes for the waterfalls. Zipline, quad and buggy have age, height and weight limits.',
  ticket_cancel: 'Free cancellation: reply to this e-mail or call {phone}.',
  ticket_seeYou: 'See you in the valley!',
  ticket_title: 'Your ticket is ready',
  ticket_intro: 'Hi {name}, your day in the valley is booked. Show this QR code at the gate:',
  ticket_qrAlt: 'Ticket QR code {ref}',
  label_visit: 'VISIT',
  label_arrival: 'ARRIVAL',
  label_party: 'PARTY',
  label_total: 'Total',
  ticket_save: 'Save it to your phone, or add it to WhatsApp from the ticket page.',
  ticket_signHead: 'Sign your waivers {deadline}',
  ticket_signBody: 'Ziplines, quads and buggies need a signed safety waiver for every participant. Fill it in on your phone, one per person, and walk straight past the paperwork at the gate. Unsigned on the day means filling it in at the desk before the briefing.',
  ticket_hereHead: 'Getting here.',
  ticket_openMaps: 'Open in Google Maps',
  ticket_parking: 'Free parking at the gate.',
  ticket_bringHead: 'Bring.',
  ticket_bringBody: 'Closed shoes, sunscreen, water and a change of clothes for the waterfalls. Zipline, quad and buggy have age, height and weight limits.',
  ticket_changeHead: 'Change of plans?',
  ticket_changeBody: 'Cancellation is free: reply to this e-mail or call {phone}.',

  // waiver link
  waiverLink_subject: 'Sign your safety waivers · {ref}',
  waiverLink_title: 'Sign your waivers before you arrive',
  waiverLink_text1: 'Hi {name}, one thing before your visit to VALLÉ Advenature™ Park on {date}:',
  waiverLink_text2: 'each participant needs a signed safety waiver (Disclaimer Form). Sign it on your phone {deadline}, one per person, and skip the paperwork at the gate:',
  waiverLink_html1: 'Hi {name}, one thing before your visit on <strong>{date}</strong>:',
  waiverLink_left: '{left} of {required} still to sign · ',
  waiverLink_html2: 'Each participant needs a signed safety waiver (Disclaimer Form). Fill it in on your phone {deadline}, one per person, and walk straight past the paperwork at the gate.',

  // reminder
  rem_subject: 'Tomorrow at VALLÉ · {ref}',
  rem_title: 'See you tomorrow',
  rem_hi: 'See you tomorrow at VALLÉ Advenature™ Park, {name}! 🌴',
  rem_paid: 'Already paid.',
  rem_pay: '{pay} (cash or card).',
  rem_waiverOpen: 'Waivers: sign them tonight and skip the queue at the gate: {url}',
  rem_waiverDone: 'Waivers: all {required} signed, thank you. Straight to the briefing tomorrow.',
  rem_waiverMissing: '⚠️ Waivers: {left} of {required} still unsigned. Sign tonight (2 minutes each) or fill them in at the desk before the briefing: {url}',
  rem_bring: 'Bring closed shoes, sunscreen and water. Reply here or call {phone} if anything changes.',

  // photos
  photos_subject: 'Your VALLÉ photos are ready · {ref}',
  photos_title: 'Your photos are ready',
  photos_hi: 'Hi {name}, your photos from VALLÉ Advenature™ Park are ready! 📸',
  photos_text_one: '{n} photo from {date} are waiting on your ticket page, yours to download and keep:',
  photos_text_two: '{n} photos from {date} are waiting on your ticket page, yours to download and keep:',
  photos_text_few: '{n} photos from {date} are waiting on your ticket page, yours to download and keep:',
  photos_text_many: '{n} photos from {date} are waiting on your ticket page, yours to download and keep:',
  photos_text_other: '{n} photos from {date} are waiting on your ticket page, yours to download and keep:',
  photos_html_one: 'Hi {name}, {n} photo from your visit on <strong>{date}</strong> are on your ticket page, yours to download and keep.',
  photos_html_two: 'Hi {name}, {n} photos from your visit on <strong>{date}</strong> are on your ticket page, yours to download and keep.',
  photos_html_few: 'Hi {name}, {n} photos from your visit on <strong>{date}</strong> are on your ticket page, yours to download and keep.',
  photos_html_many: 'Hi {name}, {n} photos from your visit on <strong>{date}</strong> are on your ticket page, yours to download and keep.',
  photos_html_other: 'Hi {name}, {n} photos from your visit on <strong>{date}</strong> are on your ticket page, yours to download and keep.',
  btn_seePhotos: 'See my photos',

  // saved booking
  draft_subject: 'Your VALLÉ day, saved',
  draft_text: 'Hi,\n\nYour booking at VALLÉ Advenature Park is saved, not booked yet. Pick it up where you left off, any time in the next 14 days:\n\n{link}\n\nNothing is reserved until you confirm on that page. Questions? Call {phone}.\n\nVALLÉ Advenature Park',

  // restaurant tables
  table_subject: 'Your table at {restaurant} · {date} {time}',
  table_request: 'We have your request for a table of {party} at {restaurant} on {date} at {time}. The team confirms it shortly by e-mail or phone.',
  table_preorder: 'Pre-order:',
  table_changes: 'Changes or questions: reply to this e-mail or call {phone}.',
  table_confirmedSubject: 'Confirmed: your table at {restaurant} · {date} {time}',
  table_cancelledSubject: 'Cancelled: your table at {restaurant} · {date} {time}',
  table_confirmed: 'Your table of {party} at {restaurant} on {date} at {time} is confirmed. See you then!',
  table_cancelled: 'We could not keep a table of {party} at {restaurant} on {date} at {time}. Call {phone} and we will find another time.',

  // receipt PDF
  rc_docTitle: 'Receipt {ref}',
  rc_titleDue: 'BOOKING RECEIPT',
  rc_titlePaid: 'PAID RECEIPT',
  rc_booking: 'BOOKING',
  rc_items: 'ITEMS',
  rc_payment: 'PAYMENT',
  rc_visit: 'Visit {date}',
  rc_morning: 'morning arrival',
  rc_afternoon: 'afternoon arrival',
  rc_postponed: 'POSTPONED, new date to be chosen',
  rc_cancelled: 'CANCELLED',
  rc_subtotal: 'Subtotal',
  rc_explorer: 'Explorer Pass discount (15%)',
  rc_foc: 'FOC pass',
  rc_discount: 'Discount',
  rc_entryFree: 'Free park entry',
  rc_adjustment: 'Adjustment',
  rc_code: 'code {code}',
  rc_total: 'Total',
  rc_paid: 'Paid',
  rc_receiptNo: 'receipt {no}',
  rc_cash: 'Cash',
  rc_card: 'Card',
  rc_juice: 'Juice (MCB)',
  rc_online: 'Online',
  rc_other: 'Other',
  rc_refund: 'Refund due to the guest',
  rc_balanceDue: 'Balance to pay at the gate',
  rc_balance: 'Balance',
  rc_onlinePending: 'Online payment pending.',
  rc_terms: 'Free change or cancellation up to the day of the visit; what was paid is refunded, except Expo deals and photo and video packages. On the day, a paid activity that can go ahead is not refunded if not taken; rain or weather is not a ground for cancellation. A visit stopped by the park for weather is postponed to a date of your choice (Disclaimer Form, clause 12).',
};

export type GuestKey = keyof typeof en;
export type GuestCatalogue = Record<GuestKey, string>;
