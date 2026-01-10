import React from 'react';
import { Heart, MessageSquare } from 'lucide-react';
import { Badge } from './ui';

const THEME_STYLES = {
  Nature: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  Fashion: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  Street: 'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:border-cyan-700',
  Portrait: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-700',
  Minimalist: 'bg-white text-blue-900 border-blue-200 dark:bg-slate-950 dark:text-blue-100 dark:border-blue-900',
};

const getThemeStyle = (theme) => THEME_STYLES[theme] || 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
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

export default function PostCard({ post, onClick, onToggleLike, liked }) {
  const { title, imageUrl, authorName, styles = [], likes = 0, commentsCount = 0, triggers = [], appliedTriggers = [], makerTags = [] } = post;
  const sensitiveFlag = post.sensitive || appliedTriggers.length > 0 || makerTags.length > 0;
  const resolvedTriggers = Array.from(new Set([...appliedTriggers, ...makerTags, ...triggers]))
    .map((trigger) => TRIGGER_LABELS[trigger] || trigger);

  return (
    <div
      onClick={onClick}
      className="group bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl shadow-slate-900/5 hover:-translate-y-1 transition-all cursor-pointer"
    >
      <div className="relative">
        {sensitiveFlag && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 text-white">
            <p className="font-semibold">Gevoelige content</p>
            <p className="text-sm opacity-80">Klik om te bekijken</p>
          </div>
        )}
        <img src={imageUrl} alt={title} className="h-60 w-full object-cover" />
      </div>
      <div className="p-5 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-slate-400">{authorName || 'Onbekend'}</p>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
          </div>
          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400">
            <button
              className={`flex items-center gap-1 px-3 py-2 rounded-full text-sm border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 ${liked ? 'text-red-500' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                onToggleLike();
              }}
            >
              <Heart size={16} fill={liked ? 'currentColor' : 'none'} /> {likes}
            </button>
            <div className="flex items-center gap-1 px-3 py-2 rounded-full text-sm border border-slate-200 dark:border-slate-800">
              <MessageSquare size={16} /> {commentsCount}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {styles.map((style) => (
            <Badge key={style} colorClass={getThemeStyle(style)}>
              {style}
            </Badge>
          ))}
          {resolvedTriggers.map((trigger) => (
            <Badge key={trigger} colorClass="bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800">
              {trigger}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
