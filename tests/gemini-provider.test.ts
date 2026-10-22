import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventType, type RunAgentInput } from '@ag-ui/core';
import { lastValueFrom, toArray } from 'rxjs';
import { DotAgent } from '../src/server/dot-agent.js';
import { Store } from '../src/server/store.js';
import { WorkspaceStore } from '../src/server/workspace.js';
import { completion } from './fixtures/model-stream.js';
import {
  missingProviderLabels,
  resolveProvider,
  type ProviderCredentials,
} from '../src/server/provider-config.js';
import {
  INTELLIGENCE_KEY_MISSING_LABEL,
  setupStatus,
  type PlatformConfig,
} from '../src/server/platform-config.js';
import { research, type Config } from '../src/server/research.js';

const databases: Array<{ close(): void }> = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  databases.splice(0).forEach((db) => db.close());
});

describe('Gemini provider configuration', () => {
  it('defaults to openai provider when AI_PROVIDER is not set', () => {
    const creds = resolveProvider({});
    expect(creds.provider).toBe('openai');
    expect(creds.baseUrl).toBe('https://api.openai.com/v1');
    expect(creds.apiKey).toBeUndefined();
    expect(creds.model).toBeUndefined();
  });

  it('parses openai credentials from environment', () => {
    const creds = resolveProvider({
      AI_PROVIDER: 'openai',
      OPENAI_API_KEY: 'sk-test-openai',
      OPENAI_MODEL: 'gpt-4o',
      OPENAI_BASE_URL: 'https://custom.openai.proxy/v1',
    });
    expect(creds.provider).toBe('openai');
    expect(creds.apiKey).toBe('sk-test-openai');
    expect(creds.model).toBe('gpt-4o');
    expect(creds.baseUrl).toBe('https://custom.openai.proxy/v1');
  });

  it('parses gemini credentials from environment case-insensitively', () => {
    const creds = resolveProvider({
      AI_PROVIDER: 'Gemini ',
      GEMINI_API_KEY: 'AIzaSyTestGeminiKey',
      GEMINI_MODEL: 'gemini-2.5-flash',
    });
    expect(creds.provider).toBe('gemini');
    expect(creds.apiKey).toBe('AIzaSyTestGeminiKey');
    expect(creds.model).toBe('gemini-2.5-flash');
    expect(creds.baseUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    );
  });

  it('ignores OpenAI credentials when gemini is selected', () => {
    const creds = resolveProvider({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'AIzaSyGeminiKey',
      GEMINI_MODEL: 'gemini-2.5-flash',
      OPENAI_API_KEY: 'sk-should-be-ignored',
      OPENAI_MODEL: 'gpt-4o',
    });
    expect(creds.apiKey).toBe('AIzaSyGeminiKey');
    expect(creds.model).toBe('gemini-2.5-flash');
  });

  it('throws an informative error for an invalid AI_PROVIDER value', () => {
    expect(() => resolveProvider({ AI_PROVIDER: 'anthropic' })).toThrow(
      'AI_PROVIDER must be "openai" or "gemini"; got "anthropic".',
    );
  });

  it('trims whitespace and ignores empty string keys', () => {
    const creds = resolveProvider({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: '   ',
      GEMINI_MODEL: '  gemini-2.5-pro  ',
    });
    expect(creds.apiKey).toBeUndefined();
    expect(creds.model).toBe('gemini-2.5-pro');
  });
});

describe('Missing provider credentials reporting', () => {
  it('reports missing GEMINI_API_KEY and GEMINI_MODEL when gemini is selected', () => {
    const creds: ProviderCredentials = {
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    };
    expect(missingProviderLabels(creds)).toEqual([
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
    ]);
  });

  it('reports only missing GEMINI_MODEL when GEMINI_API_KEY is present', () => {
    const creds: ProviderCredentials = {
      provider: 'gemini',
      apiKey: 'key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    };
    expect(missingProviderLabels(creds)).toEqual(['GEMINI_MODEL']);
  });

  it('reports no missing labels when both Gemini credentials are present', () => {
    const creds: ProviderCredentials = {
      provider: 'gemini',
      apiKey: 'key',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    };
    expect(missingProviderLabels(creds)).toEqual([]);
  });

  it('reports OPENAI_API_KEY and OPENAI_MODEL when openai is selected and credentials are missing', () => {
    const creds: ProviderCredentials = {
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
    };
    expect(missingProviderLabels(creds)).toEqual([
      'OPENAI_API_KEY',
      'OPENAI_MODEL',
    ]);
  });
});

describe('Setup status with Gemini provider', () => {
  const baseConfig: PlatformConfig = {
    intelligenceKey: 'test-intelligence-key',
    aiProvider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    runtimeUrl: '',
    voiceName: 'marin',
    slackUsers: [],
  };

  it('reports model missing with GEMINI labels when credentials are absent', () => {
    const status = setupStatus(baseConfig);
    expect(status.model).toBe(false);
    expect(status.missing).toEqual(['GEMINI_API_KEY', 'GEMINI_MODEL']);
    // Must NOT demand OpenAI keys
    expect(status.missing).not.toContain('OPENAI_API_KEY');
    expect(status.missing).not.toContain('OPENAI_MODEL');
  });

  it('reports setup complete when Intelligence and Gemini credentials are provided', () => {
    const status = setupStatus({
      ...baseConfig,
      apiKey: 'AIzaSyTestKey',
      model: 'gemini-2.5-flash',
    });
    expect(status.intelligence).toBe(true);
    expect(status.model).toBe(true);
    expect(status.missing).toEqual([]);
  });

  it('reports missing intelligence alongside missing Gemini credentials', () => {
    const status = setupStatus({
      ...baseConfig,
      intelligenceKey: undefined,
    });
    expect(status.intelligence).toBe(false);
    expect(status.model).toBe(false);
    expect(status.missing).toEqual([
      INTELLIGENCE_KEY_MISSING_LABEL,
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
    ]);
  });
});

function geminiAgentFixture() {
  const store = new Store(':memory:');
  const workspace = new WorkspaceStore(':memory:', 'owner');
  databases.push(store, workspace);
  const dot = workspace.dots()[0];
  workspace.bindThread('thread-gemini', dot.id, 'Gemini Dot');

  const agent = new DotAgent(
    store,
    workspace,
    {
      intelligenceKey: 'test-intelligence-key',
      aiProvider: 'gemini',
      apiKey: 'AIzaSySecretGeminiKey123',
      model: 'gemini-2.5-flash',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      runtimeUrl: '',
      voiceName: 'marin',
      slackUsers: [],
    },
    dot.id,
  );

  const input: RunAgentInput = {
    threadId: 'thread-gemini',
    runId: 'run-gemini-1',
    state: {},
    context: [],
    messages: [
      { id: 'user-1', role: 'user', content: 'What is the speed of light?' },
    ],
    tools: [],
    forwardedProps: {},
  };

  return { store, workspace, dot, agent, input };
}

describe('Gemini agent execution and streaming', () => {
  it('streams response chunks from the Gemini OpenAI-compatible endpoint', async () => {
    const f = geminiAgentFixture();
    const network = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      completion({
        role: 'assistant',
        content: 'The speed of light is approximately 299,792 km/s.',
      }),
    );

    const events = await lastValueFrom(f.agent.run(f.input).pipe(toArray()));

    expect(network).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = network.mock.calls[0];
    // Must call the Google Gemini OpenAI-compatible endpoint
    expect(String(requestUrl)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );

    // Must use Bearer authentication with the Gemini API key
    const headers = new Headers(requestInit?.headers);
    expect(headers.get('authorization')).toBe(
      'Bearer AIzaSySecretGeminiKey123',
    );

    // Verify request payload specifies the configured Gemini model
    const body = JSON.parse(String(requestInit?.body));
    expect(body.model).toBe('gemini-2.5-flash');

    // Verify AG-UI streaming events were emitted
    expect(events.filter((e) => e.type === EventType.RUN_STARTED)).toHaveLength(
      1,
    );
    expect(
      events.filter((e) => e.type === EventType.RUN_FINISHED),
    ).toHaveLength(1);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: EventType.TEXT_MESSAGE_CHUNK,
          delta: 'The speed of light is approximately 299,792 km/s.',
        }),
      ]),
    );
  });

  it('executes tool calling and follow-up turns with Gemini', async () => {
    const f = geminiAgentFixture();
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        completion(
          {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'call-create-page',
                type: 'function',
                function: {
                  name: 'create_space_page',
                  arguments: JSON.stringify({
                    title: 'Physics Notes',
                    content: '# Physics Notes\nSpeed of light = 299,792 km/s.',
                  }),
                },
              },
            ],
          },
          'tool_calls',
        ),
      )
      .mockResolvedValueOnce(
        completion({
          role: 'assistant',
          content: 'Created Physics Notes successfully.',
        }),
      );

    const events = await lastValueFrom(f.agent.run(f.input).pipe(toArray()));

    // Page should be created in the workspace
    expect(f.workspace.pages.list(f.dot.spaceId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Physics Notes' }),
      ]),
    );

    expect(network).toHaveBeenCalledTimes(2);

    // Second turn must include the tool result
    const secondCallBody = JSON.parse(String(network.mock.calls[1][1]?.body));
    expect(secondCallBody.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'tool',
          tool_call_id: 'call-create-page',
          content: expect.stringContaining('Physics Notes'),
        }),
      ]),
    );

    // Events must include tool call lifecycle
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: EventType.TOOL_CALL_START,
          toolCallId: 'call-create-page',
          toolCallName: 'create_space_page',
        }),
        expect.objectContaining({
          type: EventType.TOOL_CALL_RESULT,
          toolCallId: 'call-create-page',
        }),
        expect.objectContaining({
          type: EventType.TEXT_MESSAGE_CHUNK,
          delta: 'Created Physics Notes successfully.',
        }),
        expect.objectContaining({ type: EventType.RUN_FINISHED }),
      ]),
    );
  });

  it('aborts Gemini network request when run is paused or canceled', async () => {
    const f = geminiAgentFixture();
    const started = new Promise<AbortSignal>((ready) => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) throw new Error('Expected abort signal');
            signal.addEventListener('abort', () => reject(signal.reason), {
              once: true,
            });
            ready(signal);
          }),
      );
    });

    const finished = lastValueFrom(f.agent.run(f.input).pipe(toArray()));
    const signal = await started;
    f.store.updateSettings({ paused: true });
    await finished;
    expect(signal.aborted).toBe(true);
  });
});

describe('Research with Gemini provider', () => {
  const geminiResearchConfig: Config = {
    mode: 'live',
    webSearchProvider: 'browser',
    apiKey: 'AIzaSySecretGeminiKey',
    model: 'gemini-2.5-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    browserUrl: 'http://127.0.0.1:4311',
    browserSecret: 'browser-secret-token',
  };

  it('completes research brief using Gemini endpoint and credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          title: 'Quantum Computing Overview',
          url: 'https://example.com/quantum',
          text: 'Quantum computers use qubits for computation.',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content:
                  'A concise brief on quantum computing based on the provided evidence.',
              },
            },
          ],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await research(
      'Summarize https://example.com/quantum',
      [],
      geminiResearchConfig,
      new AbortController().signal,
      () => {},
    );

    expect(result.sample).toBe(false);
    expect(result.text).toContain('A concise brief on quantum computing');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].url).toBe('https://example.com/quantum');

    // Second call must be to Gemini OpenAI compatibility endpoint
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    const headers = fetchMock.mock.calls[1][1].headers;
    expect(headers['Authorization']).toBe('Bearer AIzaSySecretGeminiKey');
  });

  it('reports provider failure when Gemini endpoint returns an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            title: 'Sample Page',
            url: 'https://example.com/test',
            text: 'Page text',
          }),
        )
        .mockResolvedValueOnce(new Response('', { status: 429 })),
    );

    await expect(
      research(
        'Read https://example.com/test',
        [],
        geminiResearchConfig,
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('429');
  });
});
