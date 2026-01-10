import React, { useEffect, useState } from 'react';
import { X, Heart, MessageSquare, Calendar, Shield } from 'lucide-react';
import { addComment, subscribeToComments, subscribeToLikes, toggleLike } from '../firebase';
import { Badge, Button, Input } from './ui';

const TRIGGER_LABELS = {
  nudityErotic: 'Naakt (erotisch)',
  explicit18: 'Expliciet 18+',
  kinkBdsm: 'Kink / BDSM',
  breathRestriction: 'Ademrestrictie',
  bloodInjury: 'Bloed / verwonding',
  horrorScare: 'Horror / schrik',
  needlesInjections: 'Naalden / injecties',
  spidersInsects: 'Spinnen / insecten',
};

export default function PhotoDetailModal({ post, onClose, currentUser }) {
  const [comments, setComments] = useState([]);
  const [likesCount, setLikesCount] = useState(post.likes || 0);
  const [liked, setLiked] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!post?.id) return () => {};
    const unsubComments = subscribeToComments(post.id, (snap) => {
      setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubLikes = subscribeToLikes(post.id, (snap) => {
      setLikesCount(snap.size);
      setLiked(!!snap.docs.find((d) => d.id === currentUser?.uid));
    });
    return () => {
      unsubComments();
      unsubLikes();
    };
  }, [post?.id, currentUser?.uid]);

  const handleLike = async () => {
    if (!currentUser) return;
    await toggleLike(post.id, currentUser.uid);
  };

  const handleComment = async (e) => {
    e.preventDefault();
    setError(null);
    if (!commentText.trim()) return;
    try {
      await addComment(post.id, {
        text: commentText,
        authorId: currentUser?.uid,
        authorName: currentUser?.displayName || 'Anoniem',
      });
      setCommentText('');
    } catch (err) {
      setError(err.message);
    }
  };

  const resolvedTriggers = Array.from(new Set([...(post.appliedTriggers || []), ...(post.makerTags || []), ...(post.triggers || [])]))
    .map((trigger) => TRIGGER_LABELS[trigger] || trigger);
  const sensitiveFlag = post.sensitive || (post.appliedTriggers || []).length > 0 || (post.makerTags || []).length > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl max-w-5xl w-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Post details</p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{post.title}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <X />
          </button>
        </div>
        <div className="grid md:grid-cols-2 gap-0">
          <img src={post.imageUrl} alt={post.title} className="w-full h-full object-cover max-h-[520px]" />
          <div className="p-6 space-y-4">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Calendar size={16} />
              <span>{post.createdAt?.toDate ? post.createdAt.toDate().toLocaleDateString() : 'Nieuw'}</span>
              {sensitiveFlag && (
                <span className="flex items-center gap-1"><Shield size={14} /> Gevoelige content</span>
              )}
            </div>
            <p className="text-slate-700 dark:text-slate-200 leading-relaxed">{post.description}</p>
            <div className="flex flex-wrap gap-2">
              {(post.styles || []).map((style) => (
                <Badge key={style} colorClass="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:border-blue-800">
                  {style}
                </Badge>
              ))}
              {resolvedTriggers.map((trigger) => (
                <Badge key={trigger} colorClass="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800">
                  {trigger}
                </Badge>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={handleLike} className={liked ? 'text-red-500' : ''}>
                <Heart size={18} fill={liked ? 'currentColor' : 'none'} /> {likesCount}
              </Button>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <MessageSquare size={18} /> {comments.length}
              </div>
            </div>
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3 bg-slate-50/60 dark:bg-slate-800/50">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Reacties</p>
              <div className="max-h-48 overflow-y-auto space-y-3">
                {comments.map((comment) => (
                  <div key={comment.id} className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                    <p className="text-sm font-semibold text-slate-800 dark:text-white">{comment.authorName || 'Anon'}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{comment.text}</p>
                  </div>
                ))}
                {!comments.length && <p className="text-sm text-slate-500">Nog geen reacties</p>}
              </div>
              <form onSubmit={handleComment} className="flex items-center gap-3">
                <Input
                  placeholder="Deel je feedback"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="flex-1"
                />
                <Button type="submit" disabled={!currentUser}>
                  <MessageSquare size={16} /> Plaats
                </Button>
              </form>
              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
