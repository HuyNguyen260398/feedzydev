import type { APIGatewayProxyResult } from 'aws-lambda';

export function json(status: number, body?: unknown): APIGatewayProxyResult {
  return {
    statusCode: status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

export function fail(status: number, code: string, message: string): APIGatewayProxyResult {
  return json(status, { error: { code, message } });
}
