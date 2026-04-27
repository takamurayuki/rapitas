import { type Comment } from '@/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

interface TaskCommentsProps {
  comments: Comment[];
  newComment: string;
  isAddingComment: boolean;
  onNewCommentChange: (value: string) => void;
  onAddComment: () => void;
  onDeleteComment: (commentId: number) => void;
}

export default function TaskComments({
  comments,
  newComment,
  isAddingComment,
  onNewCommentChange,
  onAddComment,
  onDeleteComment,
}: TaskCommentsProps) {
  return (
    <div className="bg-white dark:bg-indigo-dark-900 rounded-lg shadow-lg border border-zinc-200 dark:border-zinc-800 p-6 mt-6">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 mb-4 flex items-center gap-2">
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z"
          />
        </svg>
        コメント ({comments.length})
      </h2>

      <div className="mb-4">
        <textarea
          value={newComment}
          onChange={(e) => onNewCommentChange(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-indigo-dark-900 px-4 py-3 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          rows={3}
          placeholder="コメントを追加... (マークダウン対応)"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={onAddComment}
            disabled={!newComment.trim() || isAddingComment}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isAddingComment ? '追加中...' : 'コメント追加'}
          </button>
        </div>
      </div>

      {comments.length > 0 && (
        <div className="space-y-4">
          {comments.map((comment) => (
            <div
              key={comment.id}
              className="bg-zinc-50 dark:bg-indigo-dark-800 rounded-lg p-4"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs text-zinc-500">
                  {new Date(comment.createdAt).toLocaleString('ja-JP')}
                </span>
                <button
                  onClick={() => onDeleteComment(comment.id)}
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 text-xs"
                >
                  削除
                </button>
              </div>
              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                  {comment.content}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
