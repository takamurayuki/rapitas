import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import { WorkflowFileEditor } from '../WorkflowFileEditor';

// The mock echoes the translation key back, so assertions below match on the
// key path (e.g. 'fileEditor.preview') rather than the Japanese UI copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock('@/utils/api', () => ({
  API_BASE_URL: 'http://test:3001',
}));

function renderEditor(overrides?: { onSaved?: () => void; onCancel?: () => void }) {
  const onSaved = overrides?.onSaved ?? vi.fn();
  const onCancel = overrides?.onCancel ?? vi.fn();
  renderWithProviders(
    <WorkflowFileEditor
      taskId={5}
      fileType="plan"
      initialContent={'# Plan\n- step'}
      onSaved={onSaved}
      onCancel={onCancel}
    />,
  );
  return { onSaved, onCancel };
}

describe('WorkflowFileEditor', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables save until the content is changed (dirty)', () => {
    renderEditor();
    const save = screen.getByRole('button', { name: /save/ });
    expect(save).toBeDisabled();
  });

  it('saves the edited content and calls onSaved', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, workflowStatus: 'plan_created' }),
    });
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '# Plan\n- step\n- extra' },
    });
    const save = screen.getByRole('button', { name: /save/ });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://test:3001/workflow/tasks/5/files/plan');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body).content).toContain('- extra');
  });

  it('does not call onSaved when the save fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: async () => ({ error: 'rejected' }),
    });
    const { onSaved } = renderEditor();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: /save/ }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('cancel invokes onCancel', () => {
    const { onCancel } = renderEditor();
    fireEvent.click(screen.getByRole('button', { name: /cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('toggles a markdown preview', () => {
    renderEditor();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'fileEditor.preview' }));
    // In preview mode the textarea is replaced by the rendered markdown.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });
});
