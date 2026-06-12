export const DIDIT_APPROVED_STATUSES = ['approved'];
export const DIDIT_REJECTED_STATUSES = ['declined', 'underage'];
export const DIDIT_SUPPORT_STATUSES = ['underage', 'age_unverified'];
export const DIDIT_REFRESHABLE_STATUSES = ['in_progress', 'in_review', 'expired', 'abandoned', 'error'];

export const normalizeDiditStatus = (statusValue) => String(statusValue || '').trim().toLowerCase() || null;

export const resolveEffectiveDiditState = ({
  profileAgeVerified = false,
  persistedDiditStatus = null,
  diditUiState = null,
  hasRefreshableDiditSession = false,
} = {}) => {
  const persistedStatus = normalizeDiditStatus(persistedDiditStatus);

  if (profileAgeVerified === true) return 'approved';
  if (diditUiState === 'in_review') return 'in_review';
  if (diditUiState === 'rejected') return 'declined';
  if (diditUiState === 'underage') return 'underage';
  if (diditUiState === 'age_unverified' || diditUiState === 'verified_missing_age') return 'age_unverified';
  if (diditUiState === 'expired') return 'expired';
  if (diditUiState === 'abandoned') return 'abandoned';
  if (diditUiState === 'error') return 'error';

  if (
    persistedStatus
    && [
      'in_review',
      'declined',
      'underage',
      'age_unverified',
      'expired',
      'abandoned',
      'error',
      'started',
      'in_progress',
      'not_started',
    ].includes(persistedStatus)
  ) {
    if ((persistedStatus === 'not_started' || persistedStatus === 'started') && hasRefreshableDiditSession) return 'in_progress';
    return persistedStatus;
  }

  if (diditUiState === 'pending' || (hasRefreshableDiditSession && !persistedStatus)) return 'in_progress';
  return 'not_started';
};
