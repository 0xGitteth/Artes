import React from 'react';
import { ExternalLink } from 'lucide-react';
import { getPostCreditRows } from '../utils/postCredits';

export default function PostCreditDisplay({
  post,
  onUserClick,
  onShadowClick,
  align = 'right',
  className = '',
  itemClassName = 'cursor-pointer group',
  roleClassName = 'text-xs uppercase font-bold text-slate-400',
  nameClassName = 'text-xs font-medium text-slate-900 group-hover:text-blue-600 dark:text-white transition-colors',
}) {
  const rows = getPostCreditRows(post);
  const alignmentClass = align === 'right' ? 'text-right items-end' : 'text-left items-start';
  const nameAlignmentClass = align === 'right' ? 'justify-end' : 'justify-start';

  if (!rows.length) return null;

  return (
    <div className={`${alignmentClass} flex flex-col gap-2 ${className}`}>
      {rows.map((row) => {
        const canOpenUser = Boolean(!row.isAnonymous && row.uid && onUserClick);
        const canOpenShadow = Boolean(!row.isAnonymous && !row.uid && onShadowClick && (row.contributorId || row.name));
        const isClickable = canOpenUser || canOpenShadow;

        return (
          <button
            key={row.key}
            type="button"
            className={`${itemClassName} ${isClickable ? '' : 'cursor-default'}`}
            onClick={isClickable ? () => {
              if (canOpenUser) {
                onUserClick(row.uid);
                return;
              }
              onShadowClick({
                name: row.name,
                contributorId: row.contributorId || null,
                isAnonymous: row.isAnonymous || false,
              });
            } : undefined}
            disabled={!isClickable}
          >
            <div className={roleClassName}>{row.roleLabel}</div>
            <div className={`${nameClassName} flex items-center ${nameAlignmentClass} gap-1`}>
              {row.name} {!row.isAnonymous && !row.uid && row.contributorId && <ExternalLink className="w-3 h-3 text-slate-400" />}
            </div>
            {row.secondaryLabel && (
              <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{row.secondaryLabel}</div>
            )}
          </button>
        );
      })}
    </div>
  );
}
