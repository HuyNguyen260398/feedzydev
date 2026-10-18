import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { SettingsRepo } from '../../../src/lib/repo/settings';

const ddb = mockClient(DynamoDBDocumentClient);
const repo = new SettingsRepo(ddb as unknown as DynamoDBDocumentClient, 'settings');

beforeEach(() => ddb.reset());

describe('SettingsRepo', () => {
  it('get returns defaults when nothing is stored', async () => {
    ddb.on(GetCommand).resolves({});
    expect(await repo.get()).toEqual({ postsPerSource: 5, crawlHours: [7] });
    expect(ddb.commandCalls(GetCommand)[0].args[0].input.Key).toEqual({ id: 'global' });
  });

  it('get returns stored values, including an empty hour list', async () => {
    ddb.on(GetCommand).resolves({
      Item: { id: 'global', postsPerSource: 10, crawlHours: [], updatedAt: 't' },
    });
    expect(await repo.get()).toEqual({ postsPerSource: 10, crawlHours: [], updatedAt: 't' });
  });

  it('put stores under the global key with updatedAt', async () => {
    ddb.on(PutCommand).resolves({});
    const saved = await repo.put({ postsPerSource: 3, crawlHours: [8, 13] });
    expect(saved.updatedAt).toEqual(expect.any(String));
    expect(ddb.commandCalls(PutCommand)[0].args[0].input).toMatchObject({
      TableName: 'settings',
      Item: { id: 'global', postsPerSource: 3, crawlHours: [8, 13] },
    });
  });
});
