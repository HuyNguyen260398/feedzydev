import type { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from 'aws-lambda';

export function checkSignUp(
  event: PreSignUpTriggerEvent,
  allowedEmail: string,
): PreSignUpTriggerEvent {
  const email = event.request.userAttributes?.email;
  const allowed = allowedEmail.trim().toLowerCase();
  if (allowed === '' || typeof email !== 'string' || email.trim().toLowerCase() !== allowed) {
    throw new Error('This app is private.');
  }
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}

export const handler: PreSignUpTriggerHandler = async (event) =>
  checkSignUp(event, process.env.ALLOWED_EMAIL ?? '');
