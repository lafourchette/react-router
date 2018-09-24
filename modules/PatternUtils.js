import invariant from 'invariant'
import PathToRegexp from 'path-to-regexp'

function _compilePattern(pattern) {
  const regexp = PathToRegexp(pattern)
  const paramNames = regexp.keys.map(keyDescription => keyDescription.name)
  const tokens = PathToRegexp.parse(pattern).map(token => {
    // PathToRegexp return an array of string or object
    // we just flaten it here
    if (token !== null && typeof token === 'object') {
      return token.name
    } else {
      return token
    }
  })

  return {
    pattern,
    regexp,
    paramNames,
    tokens
  }
}

const CompiledPatternsCache = Object.create(null)

export function compilePattern(pattern) {
  if (!CompiledPatternsCache[pattern])
    CompiledPatternsCache[pattern] = _compilePattern(pattern)

  return CompiledPatternsCache[pattern]
}

/**
 * Attempts to match a pattern on the given pathname. Patterns may use
 * the following special characters:
 *
 * - :paramName     Matches a URL segment up to the next /, ?, or #. The
 *                  captured string is considered a "param"
 * - ()             Wraps a segment of the URL that is optional
 * - *              Consumes (non-greedy) all characters up to the next
 *                  character in the pattern, or to the end of the URL if
 *                  there is none
 * - **             Consumes (greedy) all characters up to the next character
 *                  in the pattern, or to the end of the URL if there is none
 *
 *  The function calls callback(error, matched) when finished.
 * The return value is an object with the following properties:
 *
 * - remainingPathname
 * - paramNames
 * - paramValues
 */
export function matchPattern(pattern, pathname) {
  // Ensure pattern starts with leading slash for consistency with pathname.
  if (pattern.charAt(0) !== '/') {
    pattern = `/${pattern}`
  }
  let { regexp, paramNames } = compilePattern(pattern)

  const match = pathname.match(regexp)
  if (match == null) {
    return null
  }

  const matchedPath = match[0]
  let remainingPathname = pathname.substr(matchedPath.length)

  if (remainingPathname) {
    // Require that the match ends at a path separator, if we didn't match
    // the full path, so any remaining pathname is a new path segment.
    if (matchedPath.charAt(matchedPath.length - 1) !== '/') {
      return null
    }

    // If there is a remaining pathname, treat the path separator as part of
    // the remaining pathname for properly continuing the match.
    remainingPathname = `/${remainingPathname}`
  }

  return {
    remainingPathname,
    paramNames,
    paramValues: match.slice(1).map(v => v && decodeURIComponent(v))
  }
}

export function getParamNames(pattern) {
  return compilePattern(pattern).paramNames
}

export function getParams(pattern, pathname) {
  const match = matchPattern(pattern, pathname)
  if (!match) {
    return null
  }

  const { paramNames, paramValues } = match
  const params = {}

  paramNames.forEach((paramName, index) => {
    params[paramName] = paramValues[index]
  })

  return params
}

/**
 * Returns a version of the given pattern with params interpolated. Throws
 * if there is a dynamic segment of the pattern for which there is no param.
 */
export function formatPattern(pattern, params) {
  params = params || {}

  const { tokens } = compilePattern(pattern)
  let parenCount = 0, pathname = '', splatIndex = 0, parenHistory = []

  let token, paramName, paramValue
  for (let i = 0, len = tokens.length; i < len; ++i) {
    token = tokens[i]

    if (token === '*' || token === '**') {
      paramValue = Array.isArray(params.splat) ? params.splat[splatIndex++] : params.splat

      invariant(
        paramValue != null || parenCount > 0,
        'Missing splat #%s for path "%s"',
        splatIndex, pattern
      )

      if (paramValue != null)
        pathname += encodeURI(paramValue)
    } else if (token === '(') {
      parenHistory[parenCount] = ''
      parenCount += 1
    } else if (token === ')') {
      const parenText = parenHistory.pop()
      parenCount -= 1

      if (parenCount)
        parenHistory[parenCount - 1] += parenText
      else
        pathname += parenText
    } else if (token === '\\(') {
      pathname += '('
    } else if (token === '\\)') {
      pathname += ')'
    } else if (token.charAt(0) === ':') {
      paramName = token.substring(1)
      paramValue = params[paramName]

      invariant(
        paramValue != null || parenCount > 0,
        'Missing "%s" parameter for path "%s"',
        paramName, pattern
      )

      if (paramValue == null) {
        if (parenCount) {
          parenHistory[parenCount - 1] = ''

          const curTokenIdx = tokens.indexOf(token)
          const tokensSubset = tokens.slice(curTokenIdx, tokens.length)
          let nextParenIdx = -1

          for (let i = 0; i < tokensSubset.length; i++) {
            if (tokensSubset[i] == ')') {
              nextParenIdx = i
              break
            }
          }

          invariant(
            nextParenIdx > 0,
            'Path "%s" is missing end paren at segment "%s"', pattern, tokensSubset.join('')
          )

          // jump to ending paren
          i = curTokenIdx + nextParenIdx - 1
        }
      }
      else if (parenCount)
        parenHistory[parenCount - 1] += encodeURIComponent(paramValue)
      else
        pathname += encodeURIComponent(paramValue)

    } else {
      if (parenCount)
        parenHistory[parenCount - 1] += token
      else
        pathname += token
    }
  }

  invariant(
    parenCount <= 0,
    'Path "%s" is missing end paren', pattern
  )

  return pathname.replace(/\/+/g, '/')
}
