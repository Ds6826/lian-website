'use strict';

const MAX_AUTHORIZATION_HEADER_LENGTH = 8192;

const isBearerTokenCharacter = (code) => (
  (code >= 48 && code <= 57)
  || (code >= 65 && code <= 90)
  || (code >= 97 && code <= 122)
  || code === 45
  || code === 46
  || code === 95
);

const parseBearerToken = (value) => {
  if (typeof value !== 'string' || value.length <= 7 || value.length > MAX_AUTHORIZATION_HEADER_LENGTH) return null;
  if (value.slice(0, 7).toLowerCase() !== 'bearer ') return null;

  const token = value.slice(7);
  for (let index = 0; index < token.length; index += 1) {
    if (!isBearerTokenCharacter(token.charCodeAt(index))) return null;
  }
  return token;
};

module.exports = { MAX_AUTHORIZATION_HEADER_LENGTH, parseBearerToken };
