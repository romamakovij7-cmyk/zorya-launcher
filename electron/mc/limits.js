// What one person may have. The site enforces the same numbers for offline nicks and Microsoft accounts;
// here they stop the extra account before it is made. Raise them for paid plans later.
// MAX_SKINS is not a plan limit: the skin library lives only on this computer (the site keeps one skin per nick, the one being worn,
// and replaces it at every change), so the number is only a guard against an absurd amount of files.
module.exports = {
  MAX_MICROSOFT_ACCOUNTS: 5,
  // Оффлайн-аккаунтов до 5, основной (ник с сайта) входит в это число. Системы Zorya (скины, плащи, сердечки) — только у основного,
  // см. mainAccount.js. Server ограничивает именно число оффлайн-НИКОВ СО СКИНАМИ, это другое число.
  MAX_OFFLINE_ACCOUNTS: 5,
  MAX_SKINS: 5000,
};
