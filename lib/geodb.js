/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const P = require('./promise')
const ACCURACY_MAX_KM = 200
const ACCURACY_MIN_KM = 25

/**
* Thin wrapper around geodb, to help log the accuracy
* and catch errors. On success, returns an object with
* `location` data. On failure, returns an empty object
**/
module.exports = (log, config) => {
  if (config.enabled === false) {
    return () => P.resolve({})
  }

  const geodb = require('fxa-geodb')(config)

  log.info({ op: 'geodb.start', enabled: config.enabled, dbPath: config.dbPath })

  return function (ip) {
    return geodb(ip)
      .then(function (location) {
        var logEventPrefix = 'fxa.location.accuracy.'
        var logEvent = 'no_accuracy_data'
        var accuracy = location.accuracy

        if (accuracy) {
          if (accuracy > ACCURACY_MAX_KM) {
            logEvent = 'unknown'
          } else if (accuracy > ACCURACY_MIN_KM && accuracy <= ACCURACY_MAX_KM) {
            logEvent = 'uncertain'
          } else if (accuracy <= ACCURACY_MIN_KM) {
            logEvent = 'confident'
          }
        }

        log.info({op: 'geodb.accuracy', 'accuracy': accuracy})
        log.info({op: 'geodb.accuracy_confidence', 'accuracy_confidence': logEventPrefix + logEvent})
        return {
          location: {
            city: location.city,
            country: location.country,
            state: location.state,
            stateCode: location.stateCode
          },
          timeZone: location.timeZone
        }
      }).catch(function (err) {
        log.error({ op: 'geodb.1', err: err.message})
        // return an empty object, so that we can still send out
        // emails without the location data
        return {}
      })
  }
}
