import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyHandler } from 'aws-lambda';
import { fetchText } from '../lib/http';
import { PostsRepo } from '../lib/repo/posts';
import { SettingsRepo } from '../lib/repo/settings';
import { SourcesRepo } from '../lib/repo/sources';
import { SubscriptionsRepo } from '../lib/repo/subscriptions';
import { route, type ApiDeps } from './router';

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const lambda = new LambdaClient({});
const crawlerFunctionName = process.env.CRAWLER_FUNCTION_NAME ?? '';

const deps: ApiDeps = {
  sources: new SourcesRepo(doc, process.env.SOURCES_TABLE ?? ''),
  posts: new PostsRepo(doc, process.env.POSTS_TABLE ?? ''),
  settings: new SettingsRepo(doc, process.env.SETTINGS_TABLE ?? ''),
  subscriptions: new SubscriptionsRepo(doc, process.env.SUBSCRIPTIONS_TABLE ?? ''),
  fetchText,
  allowedEmail: process.env.ALLOWED_EMAIL ?? '',
  invokeCrawl: async (p) => {
    await lambda.send(
      new InvokeCommand({
        FunctionName: crawlerFunctionName,
        InvocationType: 'Event',
        Payload: JSON.stringify(p),
      }),
    );
  },
};

export const handler: APIGatewayProxyHandler = (event) => route(event, deps);
