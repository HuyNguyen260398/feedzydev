import type { APIGatewayProxyEvent } from 'aws-lambda';

export function getOwnerEmail(
  event: APIGatewayProxyEvent,
  allowedEmail: string,
): 'none' | 'forbidden' | string {
  const claims = event.requestContext?.authorizer?.claims as Record<string, unknown> | undefined;
  if (!claims) return 'none';
  const email = claims.email;
  const verified = claims.email_verified;
  const allowed = allowedEmail.trim().toLowerCase();
  if (
    allowed !== '' &&
    typeof email === 'string' &&
    email.trim().toLowerCase() === allowed &&
    (verified === true || verified === 'true')
  ) {
    return email;
  }
  return 'forbidden';
}
