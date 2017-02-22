/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This is a list of popular email domains based on FxA users
const domains = [
  'gmail.com',
  'hotmail.com',
  'yahoo.com',
  'mail.ru',
  'outlook.com',
  'aol.com',
  'qq.com',
  'web.de',
  'yandex.ru',
  'gmx.de',
  'live.com',
  'comcast.net',
  't-online.de',
  'hotmail.fr',
  'msn.com',
  'yahoo.fr',
  'orange.fr',
  '163.com',
  'icloud.com',
  'hotmail.co.uk'
]

// Convert to map for quicker lookup
const domainsMap = {}
domains.forEach(function (domain) {
  domainsMap[domain] = domain
})

module.exports = domainsMap
