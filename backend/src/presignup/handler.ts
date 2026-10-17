import type { PreSignUpTriggerEvent, PreSignUpTriggerHandler } from 'aws-lambda';

/**
 * Only the federated Google flow may auto-confirm/auto-verify. Native
 * PreSignUp_SignUp / AdminCreateUser are rejected so nobody can register the
 * owner's email with their own password and get an email_verified token.
 */
export function checkSignUp(
  event: PreSignUpTriggerEvent,
  allowedEmail: string,
): PreSignUpTriggerEvent {
  const email = event.request.userAttributes?.email;
  const allowed = allowedEmail.trim().toLowerCase();
  if (
    event.triggerSource !== 'PreSignUp_ExternalProvider' ||
    allowed === '' ||
    typeof email !== 'string' ||
    email.trim().toLowerCase() !== allowed
  ) {
    throw new Error('This app is private.');
  }
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;
  return event;
}

export const handler: PreSignUpTriggerHandler = async (event) =>
  checkSignUp(event, process.env.ALLOWED_EMAIL ?? '');
