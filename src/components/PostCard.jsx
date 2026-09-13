import React from 'react';
import { Badge } from './ui';
import LikeIcon from './icons/LikeIcon';
import CommentIcon from './icons/CommentIcon';

const THEME_STYLES = {
  Nature: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
  Fashion: 'bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-800',
  Street: 'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-900/20 dark:text-cyan-200 dark:border-cyan-700',
  Portrait: 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-900/20 dark:text-indigo-200 dark:border-indigo-700',
  Minimalist: 'bg-white text-blue-900 border-blue-200 dark:bg-slate-950 dark:text-blue-100 dark:border-blue-900',
};

const getThemeStyle = (theme) => THEME_STYLES[theme] || 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
const TRIGGER_LABELS = {
  adultArtNude: '18+ Artistiek naakt',
  adultEroticSuggestive: '18+ Erotisch / suggestief',
  adultGraphicSensitive: '18+ Grafische gevoelige content',
  nudityErotic: '18+ Artistiek naakt',
  explicit18: '18+ Erotisch / suggestief',
  'Naakt (erotisch)': '18+ Artistiek naakt',
  'Expliciet 18+': '18+ Erotisch / suggestief',
  'Naakt (Artistiek)': '18+ Artistiek naakt',
  kinkBdsm: 'Kink / BDSM',
  breathRestriction: 'Ademrestrictie',
  bloodInjury: 'Bloed / verwonding',
  selfHarm: 'Zelfbeschadiging',
  suicide: 'Suïcide / bewustwording',
  eatingDisorder: 'Eetstoornis / anorexia',
  substanceDistress: 'Ernstige intoxicatie / overdosis',
  violence: 'Geweld',
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

export default function PostCard({ post, onClick, onToggleLike, liked, contentPreference, onReveal }) {
  const { title, imageUrl, authorName, styles = [], likes = 0, commentsCount = 0, triggers = [], appliedTriggers = [], makerTags = [] } = post;
  const sensitiveFlag = post.sensitive || appliedTriggers.length > 0 || makerTags.length > 0 || triggers.length > 0;
  const resolvedTriggers = Array.from(new Set([...appliedTriggers, ...makerTags, ...triggers].map(resolveTriggerKey)))
    .map((trigger) => TRIGGER_LABELS[trigger] || trigger);
  const effectivePreference = contentPreference ?? (sensitiveFlag ? 'cover' : 'show');
  const shouldCover = sensitiveFlag && effectivePreference === 'cover';

  if (effectivePreference === 'hideFeed') return null;

  return (
    <div
      onClick={onClick}
      className="group bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-xl shadow-slate-900/5 hover:-translate-y-1 transition-all cursor-pointer"
    >
      <div className="relative">
        {shouldCover && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/60 text-white">
            <p className="font-semibold">Gevoelige content</p>
            <button
              type="button"
              className="mt-2 text-sm opacity-90 underline"
              onClick={(event) => {
                event.stopPropagation();
                onReveal?.();
              }}
            >
              Klik om te bekijken
            </button>
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
              className="flex items-center gap-1 px-1 py-1 text-sm text-slate-600 dark:text-slate-300 disabled:opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                onToggleLike();
              }}
            >
              <LikeIcon size={16} active={liked} disabled={false} /> {likes}
            </button>
            <div className="flex items-center gap-1 px-1 py-1 text-sm text-slate-600 dark:text-slate-300">
              <CommentIcon size={16} active={false} /> {commentsCount}
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
