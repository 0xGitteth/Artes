import React, { useEffect, useState } from 'react';
import { X, MessageSquare, Calendar, Shield, Loader2, AlertTriangle, Bookmark } from 'lucide-react';
import { addComment, deleteComment, subscribeToComments, subscribeToLikes, toggleLike } from '../firebase';
import { updatePost, deletePost } from '../services/firebaseClient';
import { Badge, Button, Input } from './ui';
import LikeIcon from './icons/LikeIcon';
import CommentIcon from './icons/CommentIcon';
import SensitiveOverlay from './SensitiveOverlay';
import { resolvePublicDisplayName } from '../utils/publicIdentity';
import PostCreditDisplay from './PostCreditDisplay';
import PostImageDisplay from './PostImageDisplay';

const TRIGGER_LABELS = {
  adultArtNude: '18+ Artistiek naakt',
  adultEroticSuggestive: '18+ Erotisch / suggestief',
  nudityErotic: '18+ Artistiek naakt',
  explicit18: '18+ Erotisch / suggestief',
  'Naakt (erotisch)': '18+ Artistiek naakt',
  'Expliciet 18+': '18+ Erotisch / suggestief',
  'Naakt (Artistiek)': '18+ Artistiek naakt',
  kinkBdsm: 'Kink / BDSM',
  breathRestriction: 'Ademrestrictie',
  bloodInjury: 'Bloed / verwonding',
  horrorScare: 'Horror / schrik',
  needlesInjections: 'Naalden / injecties',
  spidersInsects: 'Spinnen / insecten',
};

const resolveTriggerKey = (trigger) => ({
  nudityErotic: 'adultArtNude',
  explicit18: 'adultEroticSuggestive',
  'Naakt (erotisch)': 'adultArtNude',
  'Expliciet 18+': 'adultEroticSuggestive',
  'Naakt (Artistiek)': 'adultArtNude',
}[trigger] || trigger);

const toActionErrorMessage = (error, fallbackMessage) => {
  if (!error) return fallbackMessage;
  if (error.code === 'permission-denied') {
    return 'Je account heeft nog geen rechten om te liken of reageren. Verifieer je account om door te gaan.';
  }
  return error.message || fallbackMessage;
};

export default function PhotoDetailModal({ post, onClose, currentUser, authUser, currentPublicProfile, moderationApiBase, onChallengeClick, onUserClick, onShadowClick, contentPreference = 'show', shouldCover = false, onRevealSensitivePost, onOpenMoodboardSave }) {
  const user = currentUser || authUser || null;
  const [comments, setComments] = useState([]);
  const [likesCount, setLikesCount] = useState(post.likes || 0);
  const [liked, setLiked] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [actionError, setActionError] = useState(null);
  const [likeLoading, setLikeLoading] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState(null);
  const [reportState, setReportState] = useState({ status: 'idle', error: null });
  const [editState, setEditState] = useState({ saving: false, error: null, success: false });
  const [deleteState, setDeleteState] = useState({ confirm: false, deleting: false, error: null });
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post?.title || '');
  const [editDescription, setEditDescription] = useState(post?.description || '');
  const publicCommentAuthorName = resolvePublicDisplayName(currentPublicProfile);

  const canReport = Boolean(user && moderationApiBase);
  const isOwner = Boolean(user?.uid && post?.authorId === user.uid);

  useEffect(() => {
    setIsEditing(false);
    setEditState({ saving: false, error: null, success: false });
    setDeleteState({ confirm: false, deleting: false, error: null });
    setReportState({ status: 'idle', error: null });
    setActionError(null);
    setDeletingCommentId(null);
    setEditTitle(post?.title || '');
    setEditDescription(post?.description || '');
  }, [post?.id, post?.title, post?.description]);

  useEffect(() => {
    if (!post?.id) return () => {};
    const unsubComments = subscribeToComments(post.id, (snap) => {
      setComments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubLikes = subscribeToLikes(post.id, (snap) => {
      setLikesCount(snap.size);
      setLiked(!!snap.docs.find((d) => d.id === user?.uid));
    });
    return () => {
      unsubComments();
      unsubLikes();
    };
  }, [post?.id, user?.uid]);

  useEffect(() => {
    if (contentPreference === 'hideFeed') {
      onClose?.();
    }
  }, [contentPreference, onClose]);

  const handleLike = async () => {
    if (!user || likeLoading) return;
    setActionError(null);
    setLikeLoading(true);
    try {
      await toggleLike(post.id, user.uid);
    } catch (error) {
      setActionError(toActionErrorMessage(error, 'Liken mislukt. Probeer het opnieuw.'));
    } finally {
      setLikeLoading(false);
    }
  };

  const handleComment = async (e) => {
    e.preventDefault();
    setActionError(null);
    if (!commentText.trim() || !user || commentLoading) return;
    setCommentLoading(true);
    try {
      await addComment(post.id, {
        text: commentText.trim(),
        authorId: user.uid,
        authorName: publicCommentAuthorName,
      });
      setCommentText('');
    } catch (error) {
      setActionError(toActionErrorMessage(error, 'Reageren mislukt. Probeer het opnieuw.'));
    } finally {
      setCommentLoading(false);
    }
  };


  const handleDeleteComment = async (comment) => {
    if (!user?.uid || !post?.id || !comment?.id || deletingCommentId) return;
    if (comment.authorId !== user.uid) {
      setActionError('Je kunt alleen je eigen reacties verwijderen.');
      return;
    }
    const shouldDelete = window.confirm('Weet je zeker dat je deze reactie wilt verwijderen?');
    if (!shouldDelete) return;

    setActionError(null);
    setDeletingCommentId(comment.id);
    try {
      await deleteComment(post.id, comment.id);
    } catch (error) {
      setActionError(toActionErrorMessage(error, 'Reactie verwijderen mislukt. Probeer het opnieuw.'));
    } finally {
      setDeletingCommentId(null);
    }
  };

  const handleReport = async () => {
    if (!canReport || reportState.status === 'pending' || reportState.status === 'sent') return;
    const shouldReport = window.confirm('Weet je zeker dat je deze foto wilt rapporteren?');
    if (!shouldReport) return;
    setReportState({ status: 'pending', error: null });
    try {
      const contributorUids = Array.isArray(post.credits)
        ? post.credits.map((credit) => credit?.uid).filter(Boolean)
        : [];
      const reviewerTargets = new Set([post.authorId, ...contributorUids].filter(Boolean));
      const token = await user.getIdToken();
      const response = await fetch(`${moderationApiBase}/reportPost`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          postId: post.id,
          reviewerTargets: Array.from(reviewerTargets),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || 'Rapporteren mislukt.');
      }
      setReportState({ status: 'sent', error: null });
    } catch (error) {
      setReportState({ status: 'error', error: error.message || 'Rapporteren mislukt.' });
    }
  };

  const handleSave = async () => {
    if (!isOwner || editState.saving) return;
    setEditState({ saving: true, error: null, success: false });
    try {
      await updatePost(post.id, {
        title: editTitle.trim(),
        description: editDescription.trim(),
      });
      setEditState({ saving: false, error: null, success: true });
      setIsEditing(false);
    } catch (error) {
      setEditState({ saving: false, error: error.message || 'Opslaan mislukt.', success: false });
    }
  };

  const handleDelete = async () => {
    if (!isOwner || deleteState.deleting) return;
    setDeleteState((prev) => ({ ...prev, deleting: true, error: null }));
    try {
      await deletePost(post.id);
      setDeleteState({ confirm: false, deleting: false, error: null });
      onClose();
    } catch (error) {
      setDeleteState((prev) => ({
        ...prev,
        deleting: false,
        error: error.message || 'Verwijderen mislukt.',
      }));
    }
  };

  const resolvedTriggers = Array.from(new Set([...(post.appliedTriggers || []), ...(post.makerTags || []), ...(post.triggers || [])].map(resolveTriggerKey)))
    .map((trigger) => TRIGGER_LABELS[trigger] || trigger);
  const sensitiveFlag = post.sensitive || (post.appliedTriggers || []).length > 0 || (post.makerTags || []).length > 0;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-2 md:p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-3xl shadow-2xl max-w-5xl w-full max-h-[calc(100dvh-1rem)] md:max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2 md:px-6 md:py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">Post details</p>
            <h3 className="line-clamp-1 text-base md:text-lg font-semibold text-slate-900 dark:text-white">{post.title}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
            <X />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 md:grid-cols-2 gap-0 overflow-y-auto md:overflow-hidden no-scrollbar">
          <PostImageDisplay
            src={post.imageUrl}
            alt={post.title}
            imageMeta={post.imageMeta}
            className="flex items-center justify-center w-full bg-slate-100 dark:bg-slate-800 min-h-[180px] max-h-[38dvh] md:min-h-[420px] md:max-h-[70vh]"
            imageClassName="relative z-0 block max-h-[38dvh] md:max-h-[70vh] w-auto max-w-full object-contain"
            panoramaFrameClassName="h-[180px] max-h-[38dvh] md:h-[420px] md:max-h-[70vh]"
            shouldCover={shouldCover}
            overlay={<SensitiveOverlay className="absolute inset-0 z-20" onReveal={() => onRevealSensitivePost?.(post.id)} />}
          />
          <div className="p-3 md:p-6 space-y-3 md:space-y-4 overflow-visible md:overflow-y-auto no-scrollbar md:max-h-[80vh]">
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Calendar size={16} />
              <span>{post.createdAt?.toDate ? post.createdAt.toDate().toLocaleDateString() : 'Nieuw'}</span>
              {sensitiveFlag && (
                <span className="flex items-center gap-1"><Shield size={14} /> Gevoelige content</span>
              )}
              {post?.isChallenge && (
                <Badge
                  colorClass="bg-amber-100 text-amber-900 border-amber-200"
                  className="cursor-pointer"
                  onClick={() => onChallengeClick?.()}
                >
                  Challenge
                </Badge>
              )}
            </div>
            <div className="rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-3 md:p-4">
              <PostCreditDisplay
                post={post}
                onUserClick={onUserClick}
                onShadowClick={onShadowClick}
                align="left"
                itemClassName="group text-left"
                roleClassName="text-xs uppercase font-bold tracking-[0.08em] text-slate-400"
                nameClassName="text-sm font-semibold text-slate-800 group-hover:text-blue-600 dark:text-slate-100 transition-colors"
              />
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

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleLike}
                disabled={!user || likeLoading}
                className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-60"
              >
                {likeLoading ? <Loader2 size={18} className="animate-spin" /> : <LikeIcon size={18} active={liked} disabled={!user || likeLoading} />} {likesCount}
              </button>
              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                <CommentIcon size={18} active /> {comments.length}
              </div>
              <button
                type="button"
                onClick={() => onOpenMoodboardSave?.(post)}
                disabled={!user || !post?.id}
                className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-60 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200"
              >
                <Bookmark className="w-4 h-4" /> Opslaan in moodboard
              </button>
              <button
                type="button"
                onClick={handleReport}
                disabled={!canReport || reportState.status === 'pending'}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
              >
                <AlertTriangle className="w-4 h-4" /> Rapporteer foto
              </button>
            </div>
            {reportState.status === 'sent' && <p className="text-xs text-emerald-600">Melding verstuurd.</p>}
            {reportState.error && <p className="text-xs text-red-500">{reportState.error}</p>}

            {isOwner && (
              <div className="rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-700 p-3 md:p-4 space-y-3 bg-slate-50/50 dark:bg-slate-800/30">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Beheer je post</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing((prev) => !prev);
                        setEditState({ saving: false, error: null, success: false });
                      }}
                      className="text-xs px-3 py-1 rounded-full bg-slate-200 dark:bg-slate-700"
                    >
                      {isEditing ? 'Annuleren' : 'Bewerken'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteState((prev) => ({ ...prev, confirm: !prev.confirm, error: null }))}
                      className="text-xs px-3 py-1 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-200"
                    >
                      Verwijderen
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="space-y-2">
                    <Input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} placeholder="Titel" />
                    <textarea
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      value={editDescription}
                      onChange={(event) => setEditDescription(event.target.value)}
                      rows={3}
                    />
                    {editState.error && <p className="text-xs text-red-500">{editState.error}</p>}
                    {editState.success && <p className="text-xs text-emerald-600">Wijzigingen opgeslagen.</p>}
                    <div className="flex justify-end">
                      <Button type="button" onClick={handleSave} disabled={editState.saving}>
                        {editState.saving ? 'Opslaan...' : 'Opslaan'}
                      </Button>
                    </div>
                  </div>
                )}

                {deleteState.confirm && (
                  <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 space-y-2">
                    <p className="text-xs text-red-700 dark:text-red-200">Weet je zeker dat je deze post wilt verwijderen?</p>
                    {deleteState.error && <p className="text-xs text-red-500">{deleteState.error}</p>}
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="secondary" onClick={() => setDeleteState((prev) => ({ ...prev, confirm: false }))}>Annuleren</Button>
                      <Button type="button" onClick={handleDelete} disabled={deleteState.deleting} className="bg-red-600 hover:bg-red-700 text-white">
                        {deleteState.deleting ? 'Verwijderen...' : 'Bevestig verwijderen'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl md:rounded-2xl p-3 md:p-4 space-y-3 bg-slate-50/60 dark:bg-slate-800/50">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Reacties</p>
              <div className="max-h-36 md:max-h-48 overflow-y-auto no-scrollbar space-y-2 md:space-y-3">
                {comments.map((comment) => {
                  const canDeleteComment = Boolean(user?.uid && comment.authorId === user.uid);
                  return (
                    <div key={comment.id} className="group p-2.5 md:p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-800 dark:text-white">{comment.authorName || 'Anon'}</p>
                          <p className="text-sm text-slate-600 dark:text-slate-300">{comment.text}</p>
                        </div>
                        {canDeleteComment && (
                          <button
                            type="button"
                            onClick={() => handleDeleteComment(comment)}
                            className="px-1 text-slate-400 hover:text-red-500 transition opacity-100 md:opacity-0 md:group-hover:opacity-100"
                            aria-label="Verwijder reactie"
                            title="Verwijder reactie"
                            disabled={deletingCommentId === comment.id}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {!comments.length && <p className="text-sm text-slate-500 dark:text-slate-300">Nog geen reacties</p>}
              </div>
              <form onSubmit={handleComment} className="flex items-center gap-2 md:gap-3">
                <Input
                  placeholder="Deel je feedback"
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  className="flex-1"
                  disabled={!user || commentLoading}
                />
                <Button type="submit" disabled={!user || commentLoading || !commentText.trim()}>
                  {commentLoading ? <Loader2 size={16} className="animate-spin" /> : <MessageSquare size={16} />} Plaats
                </Button>
              </form>
              {!user && <p className="text-sm text-slate-500 dark:text-slate-300">Log in om te liken of te reageren.</p>}
              {actionError && <p className="text-sm text-red-500">{actionError}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
