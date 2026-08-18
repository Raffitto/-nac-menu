// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'util';

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

// External Reality live HTTP is opt-in; unit tests stay offline.
if (!process.env.NAC_ALLOW_EXTERNAL_FETCH) {
  process.env.NAC_SKIP_EXTERNAL_FETCH = process.env.NAC_SKIP_EXTERNAL_FETCH || "1";
}
