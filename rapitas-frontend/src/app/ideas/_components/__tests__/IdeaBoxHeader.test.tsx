import { render, screen, fireEvent } from '@testing-library/react';
import { IdeaBoxHeader } from '../IdeaBoxHeader';

describe('IdeaBoxHeader', () => {
  it('shows empty status text when no ideas', () => {
    render(<IdeaBoxHeader totalIdeas={0} onAddClick={() => {}} />);
    expect(screen.getByText('ひらめきを気軽にメモ')).toBeInTheDocument();
  });

  it('shows idea count when ideas exist', () => {
    render(<IdeaBoxHeader totalIdeas={10} onAddClick={() => {}} />);
    expect(screen.getByText('10件のアイデア')).toBeInTheDocument();
  });

  it('shows 30+ ideas count', () => {
    render(<IdeaBoxHeader totalIdeas={35} onAddClick={() => {}} />);
    expect(screen.getByText('35件のアイデア')).toBeInTheDocument();
  });

  it('calls onAddClick when add button clicked', () => {
    const onAddClick = vi.fn();
    render(<IdeaBoxHeader totalIdeas={5} onAddClick={onAddClick} />);
    fireEvent.click(screen.getByText('アイデアを追加'));
    expect(onAddClick).toHaveBeenCalledTimes(1);
  });

  it('renders the title', () => {
    render(<IdeaBoxHeader totalIdeas={5} onAddClick={() => {}} />);
    expect(screen.getByText('アイデアボックス')).toBeInTheDocument();
  });
});
