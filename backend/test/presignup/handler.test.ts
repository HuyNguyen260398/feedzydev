import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { checkSignUp } from '../../src/presignup/handler';

function ev(email?: string): PreSignUpTriggerEvent {
  return {
    request: { userAttributes: email === undefined ? {} : { email } },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  } as unknown as PreSignUpTriggerEvent;
}

test('allows the owner case-insensitively and auto-confirms', () => {
  const out = checkSignUp(ev('OWNER@example.com'), 'owner@example.com');
  expect(out.response.autoConfirmUser).toBe(true);
  expect(out.response.autoVerifyEmail).toBe(true);
});

test('rejects other emails', () => {
  expect(() => checkSignUp(ev('other@gmail.com'), 'owner@example.com')).toThrow(
    'This app is private.',
  );
});

test('rejects a missing email and an empty allowed email', () => {
  expect(() => checkSignUp(ev(), 'owner@example.com')).toThrow('This app is private.');
  expect(() => checkSignUp(ev(''), '')).toThrow('This app is private.');
});
