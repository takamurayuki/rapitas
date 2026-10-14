/**
 * DeviationTimeline tests — only deviations are listed (in-plan rows are
 * counted, not shown), ambiguous plans show a warning instead of judgements,
 * and clicking a deviation opens its log context.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeviationTimeline } from './DeviationTimeline';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockFetch = vi.fn();

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

const okTimeline = {
  status: 'ok',
  entries: [
    {
      category: 'in_plan',
      kind: 'file_change',
      seq: 1,
      display: 'Write: src/a.ts',
      logSequence: 2,
    },
    { category: 'out_of_plan', kind: 'command', seq: 2, display: 'Bash: rm -rf x', logSequence: 7 },
    {
      category: 'planned_not_executed',
      kind: 'file_change',
      display: 'docs/**',
      declaredItem: 'docs/**',
    },
  ],
  counts: { inPlan: 1, outOfPlan: 1, plannedNotExecuted: 1 },
  byKind: { file_change: 1, command: 1, http: 0 },
  warnings: [],
  planHash: 'h',
  executionId: 9,
};

describe('DeviationTimeline', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('lists only deviations, chronologically, with counts', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(okTimeline));
    render(<DeviationTimeline taskId={5} />);
    await waitFor(() => expect(screen.getAllByTestId('deviation-item')).toHaveLength(2));
    const rows = screen.getAllByTestId('deviation-item');
    expect(rows.map((r) => r.getAttribute('data-category'))).toEqual([
      'out_of_plan',
      'planned_not_executed',
    ]);
    expect(screen.queryByText('Write: src/a.ts')).toBeNull();
    expect(screen.getByText('counts.outOfPlan:{"n":1}')).toBeInTheDocument();
  });

  test('ambiguous plan shows only the warning — no rows, no counts', async () => {
    mockFetch.mockReturnValueOnce(
      jsonResponse({ ...okTimeline, status: 'ambiguous', entries: [], counts: null, byKind: null }),
    );
    render(<DeviationTimeline taskId={5} />);
    await waitFor(() => expect(screen.getByText('ambiguous')).toBeInTheDocument());
    expect(screen.queryAllByTestId('deviation-item')).toHaveLength(0);
    expect(screen.queryByText(/counts\./)).toBeNull();
  });

  test('clicking a deviation opens its log context', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(okTimeline));
    mockFetch.mockReturnValueOnce(
      jsonResponse({ lines: [{ sequenceNumber: 7, text: 'the rm line', isTarget: true }] }),
    );
    render(<DeviationTimeline taskId={5} />);
    await waitFor(() => expect(screen.getAllByTestId('deviation-item')).toHaveLength(2));
    fireEvent.click(screen.getAllByTestId('deviation-item')[0]);
    await waitFor(() => expect(screen.getByText('the rm line')).toBeInTheDocument());
    expect(mockFetch).toHaveBeenLastCalledWith(
      'http://test:3001/workflow/executions/9/deviation-context?seq=7&before=5&after=5',
    );
  });

  test('more than 10 deviations are paginated', async () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      category: 'out_of_plan',
      kind: 'file_change',
      seq: i + 1,
      display: `Write: x${i}.ts`,
      logSequence: i,
    }));
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        ...okTimeline,
        entries,
        counts: { inPlan: 0, outOfPlan: 12, plannedNotExecuted: 0 },
      }),
    );
    render(<DeviationTimeline taskId={5} />);
    await waitFor(() => expect(screen.getAllByTestId('deviation-item')).toHaveLength(10));
  });

  test('submitting a decision posts the comment as an audit record', async () => {
    mockFetch.mockReturnValueOnce(jsonResponse(okTimeline));
    mockFetch.mockReturnValueOnce(jsonResponse({ success: true }));
    render(<DeviationTimeline taskId={5} />);
    await waitFor(() => expect(screen.getAllByTestId('deviation-item')).toHaveLength(2));
    fireEvent.change(screen.getByLabelText('commentLabel'), {
      target: { value: 'rm was intended' },
    });
    fireEvent.click(screen.getByText('approve'));
    await waitFor(() => expect(screen.getByText('saved')).toBeInTheDocument());
    const post = mockFetch.mock.calls.find((c) => c[1]?.method === 'POST');
    expect(JSON.parse(post![1].body)).toMatchObject({
      decision: 'approved',
      comment: 'rm was intended',
    });
  });
});
