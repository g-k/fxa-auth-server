#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict'

const acorn = require('acorn')
const P = require('../lib/promise')
const fs = P.promisifyAll(require('fs'), { suffix: 'P' })
const path = require('path')

const args = parseArgs()

const ACORN_OPTIONS = {
  locations: true,
  sourceType: 'script'
}
const IGNORE = new Set([ 'defaults.js', 'idp.js', 'index.js', 'validators.js' ])
const ROUTES_DIR = path.resolve(__dirname, '../lib/routes')
const FUNCTION_EXPRESSION_TYPES = new Set([ 'FunctionExpression', 'ArrowFunctionExpression' ])
const ARRAY_TYPES = new Set([ 'ArrayExpression' ])
const RETURN_TYPES = new Set([ 'ReturnStatement' ])
const OBJECT_TYPES = new Set([ 'ObjectExpression' ])
const LITERAL_TYPES = new Set([ 'Literal' ])
const IDENTIFIER_TYPES = new Set([ 'Identifier' ])
const SESSION_TOKEN_STRATEGY = /^sessionToken/
const KEY_FETCH_TOKEN_STRATEGY = /^keyFetchToken/

const docs = parseDocs(args.path)
parseRoutes()
  .then(routes => generateOutput(docs, routes))
  .then(output => writeOutput(output, args.path))

function parseArgs () {
  let outputPath

  switch (process.argv.length) {
    /* eslint-disable indent, no-fallthrough */
    case 3:
      outputPath = path.resolve(process.argv[2])
    case 2:
      break
    default:
      fail(`Usage: ${process.argv[1]} [outputPath]`)
    /* eslint-enable indent, no-fallthrough */
  }

  return {
    path: outputPath || path.resolve(__dirname, '../docs/api.md')
  }
}

function fail (message, filePath, lineNumber) {
  let debugFriendlyMessage
  if (filePath) {
    debugFriendlyMessage = `Error parsing "${filePath}"`
    if (lineNumber) {
      debugFriendlyMessage += ` at line ${lineNumber}`
    }
    debugFriendlyMessage += `:\n${message}`
  } else {
    debugFriendlyMessage = message
  }

  throw new TypeError(debugFriendlyMessage)
}

function parseDocs (docsPath) {
}

function parseRoutes () {
  return fs.readdirP(path.resolve(__dirname, '../lib/routes'))
    .then(fileNames => {
      return Promise.all(
        fileNames
          .filter(fileName => fileName.endsWith('.js') && ! IGNORE.has(fileName))
          .map(fileName => path.join(ROUTES_DIR, fileName))
          .filter(filePath => fs.statSync(filePath).isFile())
          .map(filePath => {
            return fs.readFileP(filePath)
              .then(js => ({
                path: filePath,
                ast: acorn.parse(js, ACORN_OPTIONS)
              }))
          })
      )
    })
}

function generateOutput (docs, files) {
  return files.reduce((document, file) => {
    const filePath = file.path
    const ast = file.ast

    document.contents += `\n* ${getModuleName(filePath)}\n`

    const exportedFunction = findExportedFunction(ast, filePath)
    const routes = findReturnedData(exportedFunction, filePath)
    routes.forEach(route => {
      assertType(route, OBJECT_TYPES, filePath)
      const routeMethod = findRouteMethod(route, filePath)
      const routePath = findRoutePath(route, filePath)
      const routeConfig = findRouteConfig(route, filePath)
      let routeAuthentication, routeValidation, routeResponse
      if (routeConfig) {
        routeAuthentication = findRouteAuthentication(routeConfig, filePath)
        routeValidation = findRouteValidation(routeConfig, filePath)
        routeResponse = findRouteResponse(routeConfig, filePath)
      }
      const routeHandler = findRouteHandler(route, filePath)
      const title = `${routeMethod} ${routePath}`
      document.body += `\n## ${title}\n\n`
      if (routeAuthentication) {
        let emojis = ':lock:', prefix = ''
        if (routeAuthentication.optional) {
          emojis += ':question:'
          prefix = ' Optionally'
        }
        document.body += `${emojis}${prefix} HAWK-authenticated with ${routeAuthentication.type}.\n\n`
        document.contents += `  * [${title} ${emojis} ${routeAuthentication.type}](#${getSlug(title)})\n`
      } else {
        document.contents += `  * [${title}](#${getSlug(title)})\n`
      }
      document.body += `${JSON.stringify(routeValidation, null, '  ')}\n`
      document.body += `${JSON.stringify(routeResponse, null, '  ')}\n`
      document.body += `${JSON.stringify(routeHandler, null, '  ')}\n`
    })
    return document
  }, {
    contents: '',
    body: ''
  })
}

function getModuleName (filePath) {
  return path.basename(filePath, '.js').replace(/^[a-z]/, character => character.toUpperCase())
}

function findExportedFunction (node, filePath) {
  const exported = find(node, {
    type: 'ExpressionStatement',
    expression: {
      type: 'AssignmentExpression',
      left: {
        type: 'MemberExpression',
        object: {
          type: 'Identifier',
          name: 'module'
        },
        property: {
          type: 'Identifier',
          name: 'exports'
        }
      }
    }
  }, {
    recursive: true
  })

  if (exported.length !== 1) {
    fail(`Expected 1 export, found ${exported.length}`, filePath)
  }

  const exportedFunction = exported[0].expression.right
  assertType(exportedFunction, FUNCTION_EXPRESSION_TYPES, filePath)

  return exportedFunction.body
}

function find (node, criteria, options) {
  options = options || {}

  if (match(node, criteria)) {
    return [ node ]
  }

  if (Array.isArray(node) && options.array) {
    return node.reduce((results, property) => {
      return results.concat(find(property, criteria, options))
    }, [])
  }

  if (isObject(node) && options.recursive) {
    return Object.keys(node).reduce((results, key) => {
      return results.concat(find(node[key], criteria, options))
    }, [])
  }

  return []
}

function match (node, criteria) {
  if (! isObject(node)) {
    if (node === criteria) {
      return true
    }

    return false
  }

  if (! isObject(criteria)) {
    return false
  }

  return Object.keys(criteria).every(criteriaKey => {
    return Object.keys(node).some(nodeKey => {
      return match(node[nodeKey], criteria[criteriaKey])
    })
  })
}

function isObject (node) {
  return node && typeof node === 'object'
}

function assertType (node, types, filePath) {
  if (! node) {
    fail(`Expected type [${Array.from(types).join(',')}], found nothing`, filePath)
  }

  const nodeType = node.type

  if (! types.has(nodeType)) {
    const line = node.loc.start.line
    const column = node.loc.start.column
    fail(`Expected type [${Array.from(types).join(',')}], found "${nodeType}" at column "${column}"`, filePath, line)
  }
}

function findReturnedData (functionNode, filePath) {
  let returnedData
  if (functionNode.type === 'BlockStatement') {
    const returned = find(functionNode.body, {
      type: 'ReturnStatement'
    }, {
      array: true
    })

    if (returned.length !== 1) {
      fail(`Expected 1 return statement, found ${returned.length}`, filePath)
    }

    returnedData = returned[0].argument
  } else {
    assertType(returnedData, RETURN_TYPES, filePath)
    returnedData = functionNode.argument
  }

  if (returnedData.type === 'Identifier') {
    const routeDefinitions = find(functionNode, {
      type: 'VariableDeclarator',
      id: {
        type: 'Identifier',
        name: returnedData.name
      }
    }, {
      recursive: true
    })

    if (routeDefinitions.length !== 1) {
      fail(`Expected 1 set of route definitions, found ${routeDefinitions.length}`, filePath)
    }

    returnedData = routeDefinitions[0].init
  }

  assertType(returnedData, ARRAY_TYPES, filePath)

  return returnedData.elements
}

function findRoutePath (route, filePath) {
  return findProperty(route, 'path', LITERAL_TYPES, filePath).value
}

function findProperty (node, key, types, filePath) {
  const found = find(node.properties, {
    type: 'Property',
    kind: 'init',
    key: {
      type: 'Identifier',
      name: key
    }
  }, {
    array: true
  })[0]

  if (found) {
    assertType(found.value, types, filePath)

    return found.value
  }
}

function findRouteMethod (route, filePath) {
  return findProperty(route, 'method', LITERAL_TYPES, filePath).value
}

function findRouteConfig (route, filePath) {
  return findProperty(route, 'config', OBJECT_TYPES, filePath)
}

function findRouteAuthentication (routeConfig, filePath) {
  const routeAuthentication = findProperty(routeConfig, 'auth', OBJECT_TYPES, filePath)
  if (routeAuthentication) {
    let optional = false, type

    const mode = findProperty(routeAuthentication, 'mode', LITERAL_TYPES, filePath)
    if (mode && (mode.value === 'try' || mode.value === 'optional')) {
      optional = true
    }

    const strategies = findProperty(routeAuthentication, 'strategies', ARRAY_TYPES, filePath)
    if (strategies) {
      type = strategies.elements.map(strategy => {
        assertType(strategy, LITERAL_TYPES, filePath)
        return marshallStrategy(strategy.value)
      })
      .reduce((deduped, strategy) => {
        if (deduped.indexOf(strategy) === -1) {
          deduped.push(strategy)
        }
        return deduped
      }, [])
      .join(', ')
    } else {
      const strategy = findProperty(routeAuthentication, 'strategy', LITERAL_TYPES, filePath)
      if (strategy) {
        type = marshallStrategy(strategy.value)
      }
    }

    if (! type) {
      fail('Missing authentication strategy', filePath, routeAuthentication.loc.start.line)
    }

    return { optional, type }
  }
}

function marshallStrategy (strategy) {
  if (SESSION_TOKEN_STRATEGY.test(strategy)) {
    return 'sessionToken'
  }

  if (KEY_FETCH_TOKEN_STRATEGY.test(strategy)) {
    return 'keyFetchToken'
  }

  return strategy
}

function findRouteValidation (routeConfig, filePath) {
  return findProperty(routeConfig, 'validate', OBJECT_TYPES, filePath)
}

function findRouteResponse (routeConfig, filePath) {
  return findProperty(routeConfig, 'response', OBJECT_TYPES, filePath)
}

function findRouteHandler (route, filePath) {
  try {
    return findProperty(route, 'handler', FUNCTION_EXPRESSION_TYPES, filePath).value
  } catch (error) {
    const handlerName = findProperty(route, 'handler', IDENTIFIER_TYPES, filePath).name
  }
}

function getSlug (string) {
  return string.toLowerCase().replace(/\s/g, '-').replace(/[^a-z0-9_-]/g, '')
}

function writeOutput (output, outputPath) {
  fs.writeFileSync(outputPath, output.contents + output.body, { mode: 0o644 })
}

