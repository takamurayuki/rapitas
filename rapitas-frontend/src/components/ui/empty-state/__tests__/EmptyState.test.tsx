import { render, screen } from '@testing-library/react';
import { Inbox } from 'lucide-react';
import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders the icon and title', () => {
    const { container } = render(<EmptyState icon={Inbox} title="項目がまだありません" />);
    expect(screen.getByText('項目がまだありません')).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('renders the description when provided', () => {
    render(<EmptyState icon={Inbox} title="タイトル" description="説明テキスト" />);
    expect(screen.getByText('説明テキスト')).toBeInTheDocument();
  });

  it('omits the description paragraph when not provided', () => {
    render(<EmptyState icon={Inbox} title="タイトル" />);
    expect(screen.queryByText('説明テキスト')).not.toBeInTheDocument();
  });

  it('renders the action node when provided', () => {
    render(<EmptyState icon={Inbox} title="タイトル" action={<button>作成</button>} />);
    expect(screen.getByRole('button', { name: '作成' })).toBeInTheDocument();
  });

  it('applies additional container classes', () => {
    const { container } = render(
      <EmptyState icon={Inbox} title="タイトル" className="custom-class" />,
    );
    expect(container.firstChild).toHaveClass('custom-class');
  });
});
