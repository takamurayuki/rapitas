import { render, screen, fireEvent } from '@testing-library/react';
import { IdeaBoxHeader } from '../IdeaBoxHeader';

// NOTE: IdeaBoxHeader now sources its text via next-intl; the mock echoes the
// message key so assertions below check key paths, not the Japanese copy.
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('IdeaBoxHeader', () => {
  it('shows empty status text when no ideas', () => {
    render(<IdeaBoxHeader totalIdeas={0} onAddClick={() => {}} />);
    expect(screen.getByText('header.statusEmpty')).toBeInTheDocument();
  });

  it('shows idea count when ideas exist', () => {
    render(<IdeaBoxHeader totalIdeas={10} onAddClick={() => {}} />);
    expect(screen.getByText('header.statusCount')).toBeInTheDocument();
  });

  it('shows 30+ ideas count', () => {
    render(<IdeaBoxHeader totalIdeas={35} onAddClick={() => {}} />);
    expect(screen.getByText('header.statusCount')).toBeInTheDocument();
  });

  it('calls onAddClick when add button clicked', () => {
    const onAddClick = vi.fn();
    render(<IdeaBoxHeader totalIdeas={5} onAddClick={onAddClick} />);
    fireEvent.click(screen.getByText('header.addButton'));
    expect(onAddClick).toHaveBeenCalledTimes(1);
  });

  it('renders the title', () => {
    render(<IdeaBoxHeader totalIdeas={5} onAddClick={() => {}} />);
    expect(screen.getByText('header.title')).toBeInTheDocument();
  });
});
