/**
 * WorkflowStatusChange — confirm dialog for hand-made workflow status changes.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkflowStatusChange } from '..';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://test:3001' }));

const mockFetch = vi.fn();
const onChanged = vi.fn();

const reply = (status: number, body: unknown) =>
  Promise.resolve({ ok: status < 300, status, json: () => Promise.resolve(body) });

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(() => reply(200, { success: true, queueSync: { outcome: 'ok' } }));
  onChanged.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const open = (currentStatus: 'draft' | null = 'draft') => {
  const view = render(
    <WorkflowStatusChange taskId={7} currentStatus={currentStatus} onChanged={onChanged} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'statusChange.cta' }));
  return view;
};

const save = () => screen.getByRole('button', { name: 'statusChange.submit' });

const fill = (status: string, reason: string) => {
  fireEvent.change(screen.getByLabelText('statusChange.next'), { target: { value: status } });
  fireEvent.change(screen.getByLabelText('statusChange.reason'), { target: { value: reason } });
};

describe('WorkflowStatusChange', () => {
  it('opens a confirm dialog showing the current status and the six targets', () => {
    open();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('status-change-current')).toHaveTextContent(
      'statusChange.status.draft',
    );
    const values = screen.getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual([
      '',
      'draft',
      'research_done',
      'plan_created',
      'plan_approved',
      'in_progress',
      'verify_done',
    ]);
  });

  it('shows draft as the current status when there is none', () => {
    open(null);

    expect(screen.getByTestId('status-change-current')).toHaveTextContent(
      'statusChange.status.draft',
    );
  });

  it.each([
    ['nothing is filled in', '', ''],
    ['the reason is empty', 'plan_approved', ''],
    ['the reason is blank', 'plan_approved', '   '],
    ['no status is chosen', '', 'because'],
  ])('cannot save while %s', (_label, status, reason) => {
    open();
    fill(status, reason);

    expect(save()).toBeDisabled();
    fireEvent.click(save());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('saves as the ui source with the trimmed reason and closes', async () => {
    open();
    fill('plan_approved', '  auto retry reset it  ');
    fireEvent.click(save());

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('plan_approved'));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('http://test:3001/workflow/tasks/7/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Rapitas-Source': 'ui' },
      body: JSON.stringify({ status: 'plan_approved', reason: 'auto retry reset it' }),
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists the missing files on 422, offers no force and stays open', async () => {
    mockFetch.mockImplementation(() => reply(422, { missingFiles: ['research.md', 'plan.md'] }));
    open();
    fill('plan_approved', 'why');
    fireEvent.click(save());

    expect(await screen.findByText('research.md')).toBeInTheDocument();
    expect(screen.getByText('plan.md')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('statusChange.missingFiles');
    expect(screen.queryByText(/force/i)).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the dialog open when the status was saved but the queue sync failed', async () => {
    mockFetch.mockImplementation(() => reply(200, { queueSync: { outcome: 'error' } }));
    open();
    fill('draft', 'why');
    fireEvent.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent('statusChange.syncFailed');
    expect(onChanged).toHaveBeenCalledWith('draft');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });

  it.each([
    ['a rejected request', () => reply(400, {})],
    ['a network error', () => Promise.reject(new Error('offline'))],
  ])('reports %s and stays open', async (_label, response) => {
    mockFetch.mockImplementation(response);
    open();
    fill('draft', 'why');
    fireEvent.click(save());

    expect(await screen.findByRole('alert')).toHaveTextContent('statusChange.failed');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('sends one request when save is clicked twice', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    open();
    fill('draft', 'why');
    const button = save();
    fireEvent.click(button);
    fireEvent.click(button);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that arrives after it unmounted', async () => {
    let finish: (value: unknown) => void = () => {};
    mockFetch.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const view = open();
    fill('draft', 'why');
    fireEvent.click(save());
    view.unmount();

    await act(async () => {
      finish({ ok: true, status: 200, json: () => Promise.resolve({}) });
    });

    expect(onChanged).not.toHaveBeenCalled();
  });
});
