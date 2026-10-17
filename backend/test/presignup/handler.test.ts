import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { checkSignUp } from '../../src/presignup/handler';

const EXTERNAL = 'PreSignUp_ExternalProvider';

function ev(triggerSource: string, email?: string): PreSignUpTriggerEvent {
  return {
    triggerSource,
    request: { userAttributes: email === undefined ? {} : { email } },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  } as unknown as PreSignUpTriggerEvent;
}

test('external provider with owner email (different case) passes and auto-confirms', () => {
  const out = checkSignUp(ev(EXTERNAL, 'OWNER@example.com'), 'owner@example.com');
  expect(out.response.autoConfirmUser).toBe(true);
  expect(out.response.autoVerifyEmail).toBe(true);
});

test('native sign-up with the owner email is rejected', () => {
  expect(() =>
    checkSignUp(ev('PreSignUp_SignUp', 'owner@example.com'), 'owner@example.com'),
  ).toThrow('This app is private.');
});

test('admin-create-user with the owner email is rejected', () => {
  expect(() =>
    checkSignUp(ev('PreSignUp_AdminCreateUser', 'owner@example.com'), 'owner@example.com'),
  ).toThrow('This app is private.');
});

test('external provider with another email is rejected', () => {
  expect(() => checkSignUp(ev(EXTERNAL, 'other@gmail.com'), 'owner@example.com')).toThrow(
    'This app is private.',
  );
});

test('missing email and empty allowed email are rejected', () => {
  expect(() => checkSignUp(ev(EXTERNAL), 'owner@example.com')).toThrow('This app is private.');
  expect(() => checkSignUp(ev(EXTERNAL, ''), '')).toThrow('This app is private.');
});
